import {
  aiExplainAlert,
  notificationsDailySummaryCompany,
  notificationsSend,
  type EmailProvider,
} from '@pv/adapters';
import { addDays, startOfLocalDay } from '@pv/core';
import { MockLLMProvider } from '@pv/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { explainAlertFor } from '../src/jobs/ai.js';
import { evaluateCompanyDay } from '../src/jobs/alerts.js';
import {
  dailySummaryFor,
  notificationsDailySummaryJob,
  notificationsSendJob,
} from '../src/jobs/notifications.js';
import { runJob } from '../src/runtime.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

const TZ = 'America/Mazatlan';
const HOUR = 3_600_000;
const D0 = '2026-10-01';
const localTime = (day: string, hour: number) =>
  new Date(startOfLocalDay(day, TZ).getTime() + hour * HOUR);

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  await ctx.queue.ensureQueue(notificationsSend);
  await ctx.queue.ensureQueue(notificationsDailySummaryCompany);
  await ctx.queue.ensureQueue(aiExplainAlert);
});
afterAll(() => ctx.close());

let seq = 0;
async function companyWithUsers(alertEmails: string[] = []) {
  const c = await createCompanyWithClient(ctx.owner);
  await ctx.owner.company.update({
    where: { id: c.company.id },
    data: { settings: { notifications: { alert_emails: alertEmails } } },
  });
  const user = (
    role: 'company_admin' | 'operator' | 'technician',
    status: 'active' | 'disabled' = 'active',
  ) =>
    ctx.owner.user.create({
      data: {
        companyId: c.company.id,
        email: `${role}-${++seq}-${Date.now()}@example.com`,
        name: role,
        role,
        status,
      },
    });
  const admin = await user('company_admin');
  const operator = await user('operator');
  await user('technician');
  await user('company_admin', 'disabled');
  const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
  return { ...c, admin, operator, plant };
}
type Fixture = Awaited<ReturnType<typeof companyWithUsers>>;

/** Métricas desde D0 que abren sudden_drop crítica el último día. */
async function dropMetrics(f: Fixture, devs = [1, 2, 45], extra: object = {}) {
  for (const [i, dev] of devs.entries()) {
    const data = {
      companyId: f.company.id,
      plantId: f.plant.id,
      date: new Date(`${addDays(D0, i)}T00:00:00Z`),
      clientId: f.client.id,
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 20,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 25,
      expectedTempKwh: 23,
      specificYieldKwhKwp: 4,
      prTemp: 0.8,
      prBaseline: 0.88,
      deviationPct: dev,
      isValidDay: true,
      status: 'ok' as const,
      ...extra,
    };
    await ctx.owner.plantDailyMetric.create({ data });
  }
}

const notificationsOf = (companyId: string) =>
  ctx.owner.notification.findMany({ where: { companyId }, orderBy: { recipient: 'asc' } });
async function queuedExplanations(companyId: string) {
  const jobs = await ctx.queue.boss.fetch<{
    company_id: string;
    alert_id: string;
    notify: boolean;
  }>('ai.explain_alert', { batchSize: 500 });
  return jobs.filter((j) => j.data.company_id === companyId).map((j) => j.data);
}
async function queuedSends(companyId: string) {
  const jobs = await ctx.queue.boss.fetch<{ company_id: string; notification_id: string }>(
    'notifications.send',
    { batchSize: 500 },
  );
  return jobs.filter((j) => j.data.company_id === companyId).map((j) => j.data.notification_id);
}

describe('correo de alerta nueva', () => {
  it('la evaluación encola la explicación; al explicarla se guarda una notificación por destinatario con el resumen', async () => {
    const f = await companyWithUsers();
    // El admin también está en alert_emails (con otras mayúsculas): recibe un solo correo.
    await ctx.owner.company.update({
      where: { id: f.company.id },
      data: {
        settings: {
          notifications: { alert_emails: ['Guardia@Solar.example', f.admin.email.toUpperCase()] },
        },
      },
    });
    await dropMetrics(f);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    const stats = await evaluateCompanyDay(
      ctx.jobContext(f.company.id),
      f.company.id,
      addDays(D0, 2),
    );
    expect(stats).toMatchObject({ opened: 1, explanations: 1, notify: 1 });
    const alert = await ctx.owner.alert.findFirstOrThrow({ where: { plantId: f.plant.id } });
    expect(await queuedExplanations(f.company.id)).toEqual([
      { company_id: f.company.id, alert_id: alert.id, notify: true },
    ]);
    // Antes de la explicación no sale ningún correo.
    expect(await notificationsOf(f.company.id)).toHaveLength(0);

    // La IA simulada no responde: el correo lleva el resumen de la plantilla.
    const explained = await explainAlertFor(
      ctx.jobContext(f.company.id),
      f.company.id,
      alert.id,
      true,
    );
    expect(explained).toMatchObject({ ai_status: 'failed', generated_by: 'template', emails: 2 });
    const rows = await notificationsOf(f.company.id);
    expect(rows.map((r) => r.recipient).sort()).toEqual(
      [f.admin.email, 'guardia@solar.example'].sort(),
    );
    expect(rows[0]).toMatchObject({
      status: 'queued',
      template: 'alert_opened',
      relatedType: 'alert',
      relatedId: alert.id,
      subject: `[Crítica] Caída brusca de producción — ${f.plant.name}`,
      payload: {
        alert_id: alert.id,
        severity: 'critical',
        deviation_pct: 45,
        summary: expect.stringContaining('La producción cayó de golpe'),
      },
    });
    expect((await queuedSends(f.company.id)).sort()).toEqual(rows.map((r) => r.id).sort());

    // Repetir la evaluación no vuelve a abrir ni a explicar; repetir el correo no duplica.
    expect(
      await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2)),
    ).toMatchObject({ opened: 0, explanations: 0 });
    await explainAlertFor(ctx.jobContext(f.company.id), f.company.id, alert.id, true);
    expect(await notificationsOf(f.company.id)).toHaveLength(2);
  });

  it('no notifica avisos info, alertas de días pasados ni la semilla', async () => {
    const info = await companyWithUsers();
    await dropMetrics(info, [1, 2], { daysToCleaning: 4, predictionConfidence: 'high' });
    ctx.setNow(localTime(addDays(D0, 1), 23));
    expect(
      await evaluateCompanyDay(ctx.jobContext(info.company.id), info.company.id, addDays(D0, 1)),
    ).toMatchObject({ opened: 1, explanations: 0, notify: 0 });

    const old = await companyWithUsers();
    await dropMetrics(old);
    ctx.setNow(localTime(addDays(D0, 10), 12));
    expect(
      await evaluateCompanyDay(ctx.jobContext(old.company.id), old.company.id, addDays(D0, 2)),
    ).toMatchObject({ opened: 1, explanations: 1, notify: 0 });

    const seeded = await companyWithUsers();
    await dropMetrics(seeded);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    const quiet = { ...ctx.jobContext(seeded.company.id), suppressNotifications: true };
    expect(await evaluateCompanyDay(quiet, seeded.company.id, addDays(D0, 2))).toMatchObject({
      opened: 1,
      explanations: 1,
      notify: 0,
    });
    // Aunque se pida avisar, la semilla no manda correos.
    const alert = await ctx.owner.alert.findFirstOrThrow({ where: { plantId: seeded.plant.id } });
    expect(await explainAlertFor(quiet, seeded.company.id, alert.id, true)).toMatchObject({
      emails: 0,
    });
  });
});

describe('explicación IA (ai.explain_alert)', () => {
  const valid = (resumen: string) =>
    JSON.stringify({
      resumen,
      causa_probable: 'Falla de inversor',
      otras_causas: [],
      confianza: 'media',
      que_revisar: ['Revisar alarmas del inversor'],
      urgencia: 'alta',
    });

  async function openedDrop() {
    const f = await companyWithUsers();
    await dropMetrics(f);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    const alert = await ctx.owner.alert.findFirstOrThrow({ where: { plantId: f.plant.id } });
    return { f, alert };
  }
  const usageOf = (companyId: string) =>
    ctx.owner.aiUsageMonthly.findMany({ where: { companyId } });

  it('respuesta válida: guarda la explicación de la IA y suma los tokens del mes', async () => {
    const { f, alert } = await openedDrop();
    const provider = new MockLLMProvider(() => valid('Cayó 45 % frente a su normal.'));
    ctx.setLLM(provider);
    const stats = await explainAlertFor(
      ctx.jobContext(f.company.id),
      f.company.id,
      alert.id,
      false,
    );
    expect(stats).toMatchObject({ ai_status: 'done', generated_by: 'ai', calls: 1, emails: 0 });
    const stored = await ctx.owner.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stored.aiStatus).toBe('done');
    expect(stored.aiExplanation).toMatchObject({
      resumen: 'Cayó 45 % frente a su normal.',
      generated_by: 'ai',
      model: 'modelo-rapido',
    });
    // La entrada lleva la evidencia y la pérdida calculadas por nuestro código.
    const sent = JSON.parse(
      String(provider.requests[0]?.messages[0]?.content).split('\n')[1] ?? '{}',
    );
    expect(sent).toMatchObject({
      alert: { type: 'sudden_drop', severity: 'critical' },
      evidence: { rule: 'sudden_drop', estimated_loss_kwh_per_day: expect.any(Number) },
      plant: { capacity_kwp: expect.any(Number) },
    });
    expect(JSON.stringify(sent)).not.toMatch(/phone|email|address|contact/);
    expect(await usageOf(f.company.id)).toMatchObject([
      { feature: 'alert_explanation', requests: 1, inputTokens: 100n, outputTokens: 50n },
    ]);
    ctx.setLLM(new MockLLMProvider());
  });

  it('CA F7: cifra inventada dos veces → plantilla, ai_status failed y el correo con su resumen', async () => {
    const { f, alert } = await openedDrop();
    ctx.setLLM(new MockLLMProvider(() => valid('Cayó 73 % y pierde 99 kWh.')));
    const stats = await explainAlertFor(ctx.jobContext(f.company.id), f.company.id, alert.id, true);
    expect(stats).toMatchObject({ ai_status: 'failed', generated_by: 'template', calls: 2 });
    expect(String((stats as { failure?: string }).failure)).toContain('73');
    const stored = await ctx.owner.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stored.aiExplanation).toMatchObject({ generated_by: 'template', model: null });
    const [email] = await notificationsOf(f.company.id);
    expect(email?.payload).toMatchObject({
      summary: (stored.aiExplanation as { resumen: string }).resumen,
    });
    expect((await usageOf(f.company.id))[0]?.requests).toBe(2);
    ctx.setLLM(new MockLLMProvider());
  });

  it('presupuesto agotado: plantilla sin llamar a la IA (skipped); al cruzar el 80 % avisa una vez', async () => {
    const { f, alert } = await openedDrop();
    const provider = new MockLLMProvider(() => valid('Cayó 45 % frente a su normal.'));
    ctx.setLLM(provider);
    // 150 tokens por llamada: con presupuesto de 180, la primera cruza el 80 %.
    await ctx.owner.company.update({
      where: { id: f.company.id },
      data: { aiMonthlyTokenBudget: 180 },
    });
    const job = ctx.jobContext(f.company.id);
    await explainAlertFor(job, f.company.id, alert.id, false);
    const warnings = async () =>
      (await notificationsOf(f.company.id)).filter((n) => n.template === 'ai_budget_warning');
    expect((await warnings()).map((w) => w.recipient)).toEqual([f.admin.email]);
    expect((await warnings())[0]?.subject).toBe('Uso de IA al 83 % del presupuesto del mes');

    // Ya se gastó todo: la siguiente usa la plantilla sin llamar y no vuelve a avisar.
    await ctx.owner.aiUsageMonthly.updateMany({
      where: { companyId: f.company.id },
      data: { inputTokens: 500n },
    });
    expect(await explainAlertFor(job, f.company.id, alert.id, false)).toMatchObject({
      ai_status: 'skipped',
      generated_by: 'template',
      calls: 0,
    });
    expect(provider.requests).toHaveLength(1);
    expect(await warnings()).toHaveLength(1);
    ctx.setLLM(new MockLLMProvider());
  });

  it('la evaluación diaria vuelve a pedir las explicaciones pendientes hace más de una hora', async () => {
    const { f, alert } = await openedDrop();
    await ctx.queue.boss.deleteAllJobs('ai.explain_alert');
    // Recién abierta: su job está en curso, no se duplica.
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    expect(await queuedExplanations(f.company.id)).toEqual([]);
    // Pendiente hace 2 horas (job perdido): se vuelve a encolar, sin correo.
    await ctx.owner
      .$executeRaw`UPDATE alerts SET updated_at = now() - interval '2 hours' WHERE id = ${alert.id}::uuid`;
    ctx.setNow(new Date());
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    expect(await queuedExplanations(f.company.id)).toEqual([
      { company_id: f.company.id, alert_id: alert.id, notify: false },
    ]);
  });

  it('avisos info, alertas cerradas y alertas de otra empresa no se explican', async () => {
    const { f, alert } = await openedDrop();
    await ctx.owner.alert.update({ where: { id: alert.id }, data: { status: 'resolved' } });
    expect(
      await explainAlertFor(ctx.jobContext(f.company.id), f.company.id, alert.id, false),
    ).toEqual({ skipped: 'closed' });
    const other = await companyWithUsers();
    const reopened = await ctx.owner.alert.update({
      where: { id: alert.id },
      data: { status: 'open' },
    });
    // El job corre con el company_id del payload: la alerta de A no existe para B.
    expect(
      await explainAlertFor(ctx.jobContext(other.company.id), other.company.id, reopened.id, true),
    ).toEqual({ skipped: 'not_found' });
    expect(await notificationsOf(other.company.id)).toHaveLength(0);
  });
});

/** Explica la alerta abierta de la planta y manda su correo (lo que hace ai.explain_alert). */
async function explainOpened(f: Fixture) {
  const alert = await ctx.owner.alert.findFirstOrThrow({ where: { plantId: f.plant.id } });
  await explainAlertFor(ctx.jobContext(f.company.id), f.company.id, alert.id, true);
}

describe('notifications.send', () => {
  it('envía con la marca de la empresa, marca sent y no reenvía', async () => {
    const f = await companyWithUsers();
    await ctx.owner.company.update({
      where: { id: f.company.id },
      data: { brandColor: '#7C3AED' },
    });
    await dropMetrics(f);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    await explainOpened(f);
    const [n] = await notificationsOf(f.company.id);
    const payload = { company_id: f.company.id, notification_id: n!.id };

    expect(await runJob(notificationsSendJob, payload, 0, ctx.deps)).toBe('succeeded');
    const sent = ctx.email.lastTo(f.admin.email)!;
    expect(sent.subject).toBe(n!.subject);
    expect(sent.html).toContain('background:#7C3AED');
    expect(sent.text).toContain('https://app.pv-iot.example/alerts/');
    expect(await ctx.owner.notification.findUniqueOrThrow({ where: { id: n!.id } })).toMatchObject({
      status: 'sent',
      sentAt: ctx.deps.now(),
    });

    const before = ctx.email.sent.length;
    await runJob(notificationsSendJob, payload, 0, ctx.deps);
    expect(ctx.email.sent.length).toBe(before);
  });

  it('si el proveedor falla marca failed con el error y lanza para reintentar', async () => {
    const f = await companyWithUsers();
    await dropMetrics(f);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    await explainOpened(f);
    const [n] = await notificationsOf(f.company.id);
    const broken: EmailProvider = {
      name: 'roto',
      send: async () => {
        throw new Error('SMTP 421 servicio no disponible');
      },
    };
    await expect(
      runJob(notificationsSendJob, { company_id: f.company.id, notification_id: n!.id }, 1, {
        ...ctx.deps,
        email: broken,
      }),
    ).rejects.toThrow('SMTP 421');
    expect(await ctx.owner.notification.findUniqueOrThrow({ where: { id: n!.id } })).toMatchObject({
      status: 'failed',
      error: 'Error: SMTP 421 servicio no disponible',
    });
    // El reintento con el proveedor bien sí lo envía.
    await runJob(
      notificationsSendJob,
      { company_id: f.company.id, notification_id: n!.id },
      2,
      ctx.deps,
    );
    expect((await ctx.owner.notification.findUniqueOrThrow({ where: { id: n!.id } })).status).toBe(
      'sent',
    );
  });
});

describe('resumen diario', () => {
  it('a las 07:00 locales encola el resumen de cada empresa activa', async () => {
    const f = await companyWithUsers();
    ctx.setNow(localTime('2026-10-23', 6));
    await runJob(notificationsDailySummaryJob, {}, 0, ctx.deps);
    ctx.setNow(localTime('2026-10-23', 7));
    await runJob(notificationsDailySummaryJob, {}, 0, ctx.deps);
    const jobs = await ctx.queue.boss.fetch<{ company_id: string; date: string }>(
      'notifications.daily_summary_company',
      { batchSize: 500 },
    );
    expect(jobs.filter((j) => j.data.company_id === f.company.id).map((j) => j.data.date)).toEqual([
      '2026-10-23',
    ]);
  });

  it('va a admins y operadores con alertas abiertas, lavados próximos y plantas sin datos', async () => {
    const f = await companyWithUsers(['guardia@solar.example']);
    await ctx.owner.alert.create({
      data: {
        companyId: f.company.id,
        plantId: f.plant.id,
        type: 'offline',
        severity: 'critical',
        detectedAt: localTime('2026-10-22', 12),
      },
    });
    const dirty = await createPlant(ctx.owner, f.company.id, f.client.id);
    await ctx.owner.plantDailyMetric.create({
      data: {
        companyId: f.company.id,
        plantId: dirty.id,
        date: new Date('2026-10-22T00:00:00Z'),
        clientId: f.client.id,
        postalCode: '80000',
        colonia: 'Centro',
        energyKwh: 20,
        irradiationPoaKwhM2: 6,
        expectedStcKwh: 25,
        expectedTempKwh: 23,
        specificYieldKwhKwp: 4,
        daysToCleaning: 3,
        status: 'warning',
      },
    });

    ctx.setNow(localTime('2026-10-23', 7));
    expect(
      await dailySummaryFor(ctx.jobContext(f.company.id), f.company.id, '2026-10-23'),
    ).toMatchObject({
      recipients: 3,
      open_alerts: 1,
    });
    const rows = await notificationsOf(f.company.id);
    expect(rows.map((r) => r.recipient).sort()).toEqual(
      [f.admin.email, f.operator.email, 'guardia@solar.example'].sort(),
    );
    expect(rows[0]!.payload).toMatchObject({
      date: '2026-10-23',
      open_alerts: { critical: 1, warning: 0, info: 0 },
      attention: [{ plant_name: f.plant.name, type: 'offline', severity: 'critical' }],
      upcoming_cleanings: [{ plant_name: dirty.name, days_to_cleaning: 3 }],
      offline_plants: [{ plant_name: f.plant.name }],
    });

    // El mismo día no se repite.
    await dailySummaryFor(ctx.jobContext(f.company.id), f.company.id, '2026-10-23');
    expect(await notificationsOf(f.company.id)).toHaveLength(3);
  });

  it('sin nada que reportar no envía', async () => {
    const f = await companyWithUsers();
    expect(await dailySummaryFor(ctx.jobContext(f.company.id), f.company.id, '2026-10-23')).toEqual(
      {
        date: '2026-10-23',
        skipped: 'nothing_to_report',
      },
    );
    expect(await notificationsOf(f.company.id)).toHaveLength(0);
  });
});

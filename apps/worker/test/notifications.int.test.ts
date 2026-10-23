import {
  notificationsDailySummaryCompany,
  notificationsSend,
  type EmailProvider,
} from '@pv/adapters';
import { addDays, startOfLocalDay } from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
async function queuedSends(companyId: string) {
  const jobs = await ctx.queue.boss.fetch<{ company_id: string; notification_id: string }>(
    'notifications.send',
    { batchSize: 500 },
  );
  return jobs.filter((j) => j.data.company_id === companyId).map((j) => j.data.notification_id);
}

describe('correo de alerta nueva', () => {
  it('guarda una notificación por destinatario (alert_emails + admins activos) y encola el envío', async () => {
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
    expect(stats).toMatchObject({ opened: 1, emails: 2 });

    const rows = await notificationsOf(f.company.id);
    expect(rows.map((r) => r.recipient).sort()).toEqual(
      [f.admin.email, 'guardia@solar.example'].sort(),
    );
    const alert = await ctx.owner.alert.findFirstOrThrow({ where: { plantId: f.plant.id } });
    expect(rows[0]).toMatchObject({
      status: 'queued',
      template: 'alert_opened',
      relatedType: 'alert',
      relatedId: alert.id,
      subject: `[Crítica] Caída brusca de producción — ${f.plant.name}`,
      payload: { alert_id: alert.id, severity: 'critical', deviation_pct: 45 },
    });
    expect((await queuedSends(f.company.id)).sort()).toEqual(rows.map((r) => r.id).sort());

    // Repetir la evaluación no vuelve a notificar.
    await evaluateCompanyDay(ctx.jobContext(f.company.id), f.company.id, addDays(D0, 2));
    expect(await notificationsOf(f.company.id)).toHaveLength(2);
  });

  it('no notifica avisos info, alertas de días pasados ni la semilla', async () => {
    const info = await companyWithUsers();
    await dropMetrics(info, [1, 2], { daysToCleaning: 4, predictionConfidence: 'high' });
    ctx.setNow(localTime(addDays(D0, 1), 23));
    expect(
      await evaluateCompanyDay(ctx.jobContext(info.company.id), info.company.id, addDays(D0, 1)),
    ).toMatchObject({
      opened: 1,
      emails: 0,
    });

    const old = await companyWithUsers();
    await dropMetrics(old);
    ctx.setNow(localTime(addDays(D0, 10), 12));
    expect(
      await evaluateCompanyDay(ctx.jobContext(old.company.id), old.company.id, addDays(D0, 2)),
    ).toMatchObject({
      opened: 1,
      emails: 0,
    });

    const seeded = await companyWithUsers();
    await dropMetrics(seeded);
    ctx.setNow(localTime(addDays(D0, 2), 22.5));
    const quiet = { ...ctx.jobContext(seeded.company.id), suppressNotifications: true };
    expect(await evaluateCompanyDay(quiet, seeded.company.id, addDays(D0, 2))).toMatchObject({
      opened: 1,
      emails: 0,
    });
  });
});

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

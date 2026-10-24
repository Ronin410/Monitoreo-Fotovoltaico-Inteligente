import {
  reportsGenerate,
  reportsMonthlyCompany,
  reportsSend,
  type EmailProvider,
} from '@pv/adapters';
import { MockLLMProvider } from '@pv/ai';
import { addDays, reportFactsSchema, startOfLocalDay } from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMonthlyReports,
  generateReport,
  reportsMonthlyJob,
  sendReport,
} from '../src/jobs/reports.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

// specs/08 §1: reportes del mes anterior el día 1 a las 08:00, generación (cifras → narrativa →
// PDF → storage) y envío con el PDF adjunto.

const TZ = 'America/Mazatlan';
const PERIOD = '2026-09';

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  await ctx.queue.ensureQueue(reportsMonthlyCompany);
  await ctx.queue.ensureQueue(reportsGenerate);
  await ctx.queue.ensureQueue(reportsSend);
  ctx.setNow(new Date('2026-10-01T15:00:00Z'));
});
afterAll(() => ctx.close());

let seq = 0;
/** Empresa con un cliente con planta en septiembre (y métricas) y otro que se instaló en octubre. */
async function fixture(opts: { reportEmail?: string | null; autoSend?: boolean } = {}) {
  const c = await createCompanyWithClient(ctx.owner);
  const email = opts.reportEmail === undefined ? `cliente-${++seq}@example.com` : opts.reportEmail;
  await ctx.owner.client.update({
    where: { id: c.client.id },
    data: { name: 'Abarrotes El Sol', reportEmail: email, tariffMxnPerKwh: 3.5 },
  });
  if (opts.autoSend) {
    await ctx.owner.company.update({
      where: { id: c.company.id },
      data: { settings: { notifications: { auto_send_client_reports: true } } },
    });
  }
  const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
  await ctx.owner.solarPlant.update({
    where: { id: plant.id },
    data: { commissioningDate: new Date('2026-05-01T12:00:00Z') },
  });
  for (let i = 0; i < 30; i++) {
    await ctx.owner.plantDailyMetric.create({
      data: {
        companyId: c.company.id,
        plantId: plant.id,
        date: new Date(`${addDays(`${PERIOD}-01`, i)}T00:00:00Z`),
        clientId: c.client.id,
        postalCode: '80000',
        colonia: 'Centro',
        energyKwh: 30 + (i % 4),
        irradiationPoaKwhM2: 6,
        expectedStcKwh: 38,
        expectedTempKwh: 35,
        specificYieldKwhKwp: 6,
        prTemp: 0.88,
        isValidDay: true,
        status: 'ok',
      },
    });
  }
  const late = await ctx.owner.client.create({
    data: {
      companyId: c.company.id,
      name: 'Cliente nuevo',
      address: 'x',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const latePlant = await createPlant(ctx.owner, c.company.id, late.id);
  await ctx.owner.solarPlant.update({
    where: { id: latePlant.id },
    data: { commissioningDate: new Date('2026-10-05T12:00:00Z') },
  });
  return { ...c, plant, late, email };
}

const reportsOf = (companyId: string) =>
  ctx.owner.monthlyReport.findMany({ where: { companyId }, include: { client: true } });

async function generated(opts: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture(opts);
  await createMonthlyReports(ctx.jobContext(f.company.id), f.company.id, PERIOD);
  const [report] = await reportsOf(f.company.id);
  const res = await generateReport(
    ctx.jobContext(f.company.id),
    f.company.id,
    report!.id,
    opts.autoSend ?? false,
  );
  return { ...f, reportId: report!.id, res };
}

describe('reports.monthly', () => {
  it('encola el mes anterior el día 1 a las 08:00 locales y no en otra hora', async () => {
    await fixture();
    ctx.setNow(startOfLocalDay('2026-10-02', TZ));
    expect(await reportsMonthlyJob.handler({}, ctx.jobContext(null))).toEqual({ enqueued: 0 });
    ctx.setNow(new Date(startOfLocalDay('2026-10-01', TZ).getTime() + 9 * 3_600_000));
    expect(await reportsMonthlyJob.handler({}, ctx.jobContext(null))).toEqual({ enqueued: 0 });
    ctx.setNow(new Date('2026-10-01T15:00:00Z'));
    const res = await reportsMonthlyJob.handler({}, ctx.jobContext(null));
    expect((res as { enqueued: number }).enqueued).toBeGreaterThan(0);
  });

  it('crea un reporte por cliente con planta activa en el mes, una sola vez', async () => {
    const f = await fixture();
    const job = ctx.jobContext(f.company.id);
    expect(await createMonthlyReports(job, f.company.id, PERIOD)).toMatchObject({ created: 1 });
    expect(await createMonthlyReports(job, f.company.id, PERIOD)).toMatchObject({ created: 0 });
    const reports = await reportsOf(f.company.id);
    expect(reports.map((r) => [r.clientId, r.period, r.status])).toEqual([
      [f.client.id, PERIOD, 'pending'],
    ]);
  });
});

describe('reports.generate', () => {
  it('cifras → narrativa de plantilla si la IA falla → PDF en storage → generated', async () => {
    const f = await generated();
    expect(f.res).toMatchObject({ narrative_source: 'template', auto_send: false });
    const [report] = await reportsOf(f.company.id);
    expect(report).toMatchObject({ status: 'generated', narrativeSource: 'template' });
    expect(report!.storageKey).toBe(`reports/${f.company.id}/${PERIOD}/${report!.id}.pdf`);
    const facts = reportFactsSchema.parse(report!.facts);
    expect(facts.energy_kwh).toBeGreaterThan(900);
    expect(facts.client_name).toBe('Abarrotes El Sol');
    expect(report!.narrative).toContain('septiembre');
    const pdf = await ctx.storage.get(report!.storageKey!);
    expect(pdf?.contentType).toBe('application/pdf');
    expect(pdf?.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('cuenta los tokens de la narrativa en report_narrative', async () => {
    // Texto demasiado corto: se reintenta una vez y se usa la plantilla.
    ctx.setLLM(new MockLLMProvider(() => 'Muy corto.'));
    try {
      const f = await generated();
      expect(f.res).toMatchObject({ narrative_source: 'template' });
      const usage = await ctx.owner.aiUsageMonthly.findMany({ where: { companyId: f.company.id } });
      expect(usage.map((u) => [u.period, u.feature, u.requests])).toEqual([
        ['2026-10', 'report_narrative', 2],
      ]);
    } finally {
      ctx.setLLM(new MockLLMProvider());
    }
  });

  it('con auto_send_client_reports encola el envío si el cliente tiene correo', async () => {
    expect((await generated({ autoSend: true })).res).toMatchObject({ auto_send: true });
    expect((await generated({ autoSend: true, reportEmail: null })).res).toMatchObject({
      auto_send: false,
    });
  });

  it('un reporte de otra empresa no se encuentra', async () => {
    const f = await generated();
    const other = await createCompanyWithClient(ctx.owner);
    expect(
      await generateReport(ctx.jobContext(other.company.id), other.company.id, f.reportId, false),
    ).toEqual({ skipped: 'not_found' });
    expect(
      await sendReport(ctx.jobContext(other.company.id), other.company.id, f.reportId),
    ).toEqual({ skipped: 'not_found' });
  });
});

describe('reports.send', () => {
  it('envía el PDF adjunto al correo del cliente y marca el reporte como enviado', async () => {
    const f = await generated();
    const job = ctx.jobContext(f.company.id);
    expect(await sendReport(job, f.company.id, f.reportId)).toEqual({
      period: PERIOD,
      sent: true,
    });
    const mail = ctx.email.lastTo(f.email!);
    expect(mail?.subject).toContain('septiembre de 2026');
    expect(mail?.attachments?.map((a) => [a.filename, a.contentType])).toEqual([
      ['Reporte-solar-2026-09.pdf', 'application/pdf'],
    ]);
    expect(mail?.attachments?.[0]?.content.subarray(0, 5).toString()).toBe('%PDF-');
    const [report] = await reportsOf(f.company.id);
    expect(report).toMatchObject({ status: 'sent', sentTo: f.email });
    expect(report!.sentAt).not.toBeNull();
    const notifications = await ctx.owner.notification.findMany({
      where: { companyId: f.company.id },
    });
    expect(notifications.map((n) => [n.template, n.status, n.relatedId])).toEqual([
      ['client_report', 'sent', f.reportId],
    ]);

    // Ya enviado: no se reenvía ni se regenera.
    expect(await sendReport(job, f.company.id, f.reportId)).toEqual({ skipped: 'already_sent' });
    expect(await generateReport(job, f.company.id, f.reportId, false)).toEqual({
      skipped: 'already_sent',
    });
  });

  it('sin correo de reportes o sin generar no envía', async () => {
    const f = await generated({ reportEmail: null });
    const job = ctx.jobContext(f.company.id);
    expect(await sendReport(job, f.company.id, f.reportId)).toEqual({
      skipped: 'no_report_email',
    });
    const g = await fixture();
    await createMonthlyReports(ctx.jobContext(g.company.id), g.company.id, PERIOD);
    const [pending] = await reportsOf(g.company.id);
    expect(await sendReport(ctx.jobContext(g.company.id), g.company.id, pending!.id)).toEqual({
      skipped: 'not_generated',
    });
  });

  it('si el correo falla queda registrado y el reintento usa la misma notificación', async () => {
    const f = await generated();
    const failing: EmailProvider = {
      name: 'falla',
      send: async () => {
        throw new Error('SMTP caído');
      },
    };
    await expect(
      sendReport({ ...ctx.jobContext(f.company.id), email: failing }, f.company.id, f.reportId),
    ).rejects.toThrow('SMTP caído');
    let [n] = await ctx.owner.notification.findMany({ where: { companyId: f.company.id } });
    expect(n).toMatchObject({ status: 'failed', error: 'Error: SMTP caído' });
    expect((await reportsOf(f.company.id))[0]?.status).toBe('generated');

    await sendReport(ctx.jobContext(f.company.id), f.company.id, f.reportId);
    const all = await ctx.owner.notification.findMany({ where: { companyId: f.company.id } });
    expect(all).toHaveLength(1);
    [n] = all;
    expect(n).toMatchObject({ status: 'sent', error: null });
    expect((await reportsOf(f.company.id))[0]?.status).toBe('sent');
  });
});

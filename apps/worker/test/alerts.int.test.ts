import { aiExplainAlert, alertsEvaluate } from '@pv/adapters';
import { addDays, simulationProfileSchema, startOfLocalDay } from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alertsEvaluateJob,
  alertsOfflineCompanyJob,
  evaluateCompanyDay,
} from '../src/jobs/alerts.js';
import { computeCompanyDay, metricsDailyCompanyJob } from '../src/jobs/metrics.js';
import { ingestTelemetryPlantJob } from '../src/jobs/telemetry.js';
import { ingestWeatherRange } from '../src/jobs/weather.js';
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

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  ctx.setNow(new Date('2026-11-01T00:00:00Z'));
  // Las alertas warning y critical encolan su explicación.
  await ctx.queue.ensureQueue(aiExplainAlert);
});
afterAll(() => ctx.close());

const localTime = (day: string, hour: number) =>
  new Date(startOfLocalDay(day, TZ).getTime() + hour * HOUR);
type Company = Awaited<ReturnType<typeof createCompanyWithClient>>;
type Day =
  number | { dev: number; valid?: boolean; dtc?: number; conf?: 'low' | 'medium' | 'high' };

/** Inserta métricas diarias desde D0 (un número = día válido con esa desviación). */
async function metrics(c: Company, plantId: string, days: Day[]) {
  for (const [i, d] of days.entries()) {
    const day = typeof d === 'number' ? { dev: d } : d;
    const date = new Date(`${addDays(D0, i)}T00:00:00Z`);
    const data = {
      companyId: c.company.id,
      plantId,
      date,
      clientId: c.client.id,
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 20,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 25,
      expectedTempKwh: 23,
      specificYieldKwhKwp: 4,
      prTemp: 0.88 * (1 - day.dev / 100),
      prBaseline: 0.88,
      baselineSource: 'own' as const,
      deviationPct: day.dev,
      isValidDay: day.valid ?? true,
      daysToCleaning: day.dtc ?? null,
      predictionConfidence: day.conf ?? null,
      soilingSlopePctPerDay: day.dtc ? -0.5 : null,
      status: 'ok' as const,
    };
    await ctx.owner.plantDailyMetric.upsert({
      where: { plantId_date: { plantId, date } },
      create: data,
      update: data,
    });
  }
}

const evaluate = (c: Company, i: number) =>
  evaluateCompanyDay(ctx.jobContext(c.company.id), c.company.id, addDays(D0, i));
const alertsOf = (plantId: string) =>
  ctx.owner.alert.findMany({ where: { plantId }, orderBy: { detectedAt: 'asc' } });
const metricOf = (plantId: string, i: number) =>
  ctx.owner.plantDailyMetric.findUniqueOrThrow({
    where: { plantId_date: { plantId, date: new Date(`${addDays(D0, i)}T00:00:00Z`) } },
  });

describe('alerts.evaluate', () => {
  it('abre sudden_drop crítica con evidencia, sube el estado del día y es idempotente', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
    await metrics(c, plant.id, [1, 2, 45]);

    expect(await evaluate(c, 2)).toMatchObject({ opened: 1, resolved: 0 });
    await evaluate(c, 2);
    const alerts = await alertsOf(plant.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      companyId: c.company.id,
      type: 'sudden_drop',
      severity: 'critical',
      status: 'open',
      aiStatus: 'pending',
      detectedAt: localTime(addDays(D0, 2), 22),
    });
    expect(alerts[0]!.evidence).toMatchObject({
      rule: 'sudden_drop',
      trigger: { dates: [addDays(D0, 1), addDays(D0, 2)], deviation_pct: [2, 45] },
      baseline: { value: 0.88, source: 'own' },
      last_14_days: [
        { date: D0, deviation_pct: 1, valid: true },
        { date: addDays(D0, 1), deviation_pct: 2 },
        { date: addDays(D0, 2), deviation_pct: 45 },
      ],
      cleaning_did_not_recover: false,
    });
    expect((await metricOf(plant.id, 2)).status).toBe('critical');
  });

  it('se resuelve sola con 2 días válidos bajo 10 %', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
    await metrics(c, plant.id, [1, 2, 45, 44, 3, { dev: 60, valid: false }, 4]);
    for (let i = 2; i <= 6; i++) await evaluate(c, i);
    const [alert] = await alertsOf(plant.id);
    expect(alert).toMatchObject({
      status: 'resolved',
      resolution: 'auto',
      resolvedAt: localTime(addDays(D0, 6), 22),
    });
    expect((await metricOf(plant.id, 6)).status).toBe('ok');
  });

  it('el evento de zona marca las métricas y suprime las alertas', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plants = [];
    for (let i = 0; i < 3; i++)
      plants.push(await createPlant(ctx.owner, c.company.id, c.client.id));
    for (const p of plants) await metrics(c, p.id, [1, 2, 45]);

    expect(await evaluate(c, 2)).toMatchObject({ zone_events: 3, opened: 0 });
    for (const p of plants) {
      expect((await metricOf(p.id, 2)).zoneEvent).toBe(true);
      expect(await alertsOf(p.id)).toHaveLength(0);
    }
  });

  it('el evento de zona solo agrupa plantas de la misma empresa', async () => {
    const a = await createCompanyWithClient(ctx.owner);
    const b = await createCompanyWithClient(ctx.owner);
    const own = await createPlant(ctx.owner, a.company.id, a.client.id);
    await metrics(a, own.id, [1, 2, 45]);
    for (let i = 0; i < 3; i++) {
      const other = await createPlant(ctx.owner, b.company.id, b.client.id);
      await metrics(b, other.id, [1, 2, 45]);
    }
    // Las 3 plantas de B en el mismo código postal y lugar no hacen evento de zona para A.
    expect(await evaluate(a, 2)).toMatchObject({ zone_events: 0, opened: 1 });
    expect(await alertsOf(own.id)).toHaveLength(1);
  });

  it('cleaning_due_soon abre como info sin explicación IA y se resuelve con un lavado', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
    await metrics(c, plant.id, [3, { dev: 8, dtc: 4, conf: 'medium' }, 2, 1]);
    await evaluate(c, 1);
    expect(await alertsOf(plant.id)).toMatchObject([
      { type: 'cleaning_due_soon', severity: 'info', status: 'open', aiStatus: 'skipped' },
    ]);
    expect((await metricOf(plant.id, 1)).status).toBe('warning');

    await ctx.owner.plantEvent.create({
      data: {
        companyId: c.company.id,
        plantId: plant.id,
        type: 'cleaning',
        source: 'manual',
        occurredAt: localTime(addDays(D0, 2), 9),
      },
    });
    await evaluate(c, 2);
    expect((await alertsOf(plant.id))[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
  });

  it('metrics.daily_company encola alerts.evaluate de la misma fecha', async () => {
    await ctx.queue.ensureQueue(alertsEvaluate);
    const c = await createCompanyWithClient(ctx.owner);
    await createPlant(ctx.owner, c.company.id, c.client.id);
    const date = '2026-10-15';
    expect(
      await runJob(metricsDailyCompanyJob, { company_id: c.company.id, date }, 0, ctx.deps),
    ).toBe('succeeded');
    const jobs = await ctx.queue.boss.fetch<{ company_id: string; date: string }>(
      'alerts.evaluate',
      {
        batchSize: 100,
      },
    );
    expect(jobs.map((j) => j.data)).toContainEqual({ company_id: c.company.id, date });
  });
});

describe('alerts.evaluate con el pipeline real', () => {
  it('una falla de 1 de 3 strings (33 %) en el simulador abre sudden_drop', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
    const failure = addDays(D0, 14);
    await ctx.owner.solarPlant.update({
      where: { id: plant.id },
      data: {
        simulationProfile: simulationProfileSchema.parse({
          seed: 5,
          system_efficiency: 0.88,
          ac_limit_kw: 9,
          noise_pct: 1,
          scenarios: [{ type: 'string_failure', start: failure, loss_pct: 33, end: null }],
        }),
      },
    });
    const last = addDays(D0, 19);
    await ingestWeatherRange(ctx.jobContext(c.company.id), c.company.id, {
      from: startOfLocalDay(D0, TZ),
      to: startOfLocalDay(addDays(last, 1), TZ),
    });
    for (const step of [6, 12, 18, 20]) {
      ctx.setNow(localTime(addDays(D0, step), 0));
      await runJob(
        ingestTelemetryPlantJob,
        { company_id: c.company.id, plant_id: plant.id },
        0,
        ctx.deps,
      );
    }
    ctx.setNow(new Date('2026-11-01T00:00:00Z'));
    for (let date = D0; date <= last; date = addDays(date, 1)) {
      await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, date);
      await runJob(alertsEvaluateJob, { company_id: c.company.id, date }, 0, ctx.deps);
    }
    const alerts = await alertsOf(plant.id);
    expect(alerts.filter((a) => a.type === 'sudden_drop')).toHaveLength(1);
    const drop = alerts.find((a) => a.type === 'sudden_drop')!;
    expect(drop.status).toBe('open');
    expect(drop.severity).toBe('warning');
    // Se detecta a los 2 días válidos de la falla (los nublados se saltan).
    expect(drop.detectedAt.getTime()).toBeGreaterThan(localTime(failure, 0).getTime());
    expect(drop.detectedAt.getTime()).toBeLessThan(localTime(addDays(failure, 5), 0).getTime());
  });
});

describe('alerts.offline_company', () => {
  async function plantWithLastReading(lastReadingAt: Date | null, c?: Company) {
    const company = c ?? (await createCompanyWithClient(ctx.owner));
    const plant = await createPlant(ctx.owner, company.company.id, company.client.id);
    await ctx.owner.solarPlant.update({
      where: { id: plant.id },
      data: { lastReadingAt, createdAt: new Date('2026-09-01T00:00:00Z') },
    });
    return { company, plant };
  }
  const runOffline = (companyId: string) =>
    runJob(alertsOfflineCompanyJob, { company_id: companyId }, 0, ctx.deps);

  it('abre crítica tras más de 4 horas de sol sin lecturas y se resuelve al volver', async () => {
    ctx.setNow(localTime('2026-10-21', 14));
    const { company, plant } = await plantWithLastReading(localTime('2026-10-21', 8));
    expect(await runOffline(company.company.id)).toBe('succeeded');
    const [alert] = await alertsOf(plant.id);
    expect(alert).toMatchObject({ type: 'offline', severity: 'critical', status: 'open' });
    expect(alert!.evidence).toMatchObject({ rule: 'offline', offline_hours_threshold: 4 });

    await runOffline(company.company.id);
    expect(await alertsOf(plant.id)).toHaveLength(1);

    ctx.setNow(localTime('2026-10-21', 15));
    await ctx.owner.solarPlant.update({
      where: { id: plant.id },
      data: { lastReadingAt: localTime('2026-10-21', 14.75) },
    });
    await runOffline(company.company.id);
    expect((await alertsOf(plant.id))[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
  });

  it('de noche no cuenta y un error de nuestra integración no crea alerta', async () => {
    ctx.setNow(localTime('2026-10-22', 7));
    const night = await plantWithLastReading(localTime('2026-10-21', 17));
    await runOffline(night.company.company.id);
    expect(await alertsOf(night.plant.id)).toHaveLength(0);

    ctx.setNow(localTime('2026-10-21', 14));
    const broken = await plantWithLastReading(localTime('2026-10-21', 8));
    await ctx.owner.jobRun.create({
      data: {
        jobName: 'ingest.telemetry_plant',
        companyId: broken.company.company.id,
        startedAt: localTime('2026-10-21', 13.5),
        finishedAt: localTime('2026-10-21', 13.5),
        status: 'failed',
        error: 'ProviderError: provider_error: Error',
        stats: { attempt: 2, plant_id: broken.plant.id },
      },
    });
    await runOffline(broken.company.company.id);
    expect(await alertsOf(broken.plant.id)).toHaveLength(0);
  });
});

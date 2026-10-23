import {
  addDays,
  simulationProfileSchema,
  startOfLocalDay,
  type SimulationScenario,
} from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeCompanyDay, metricsDailyJob, metricsRecomputeJob } from '../src/jobs/metrics.js';
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
const FIRST = '2026-09-01';
const DAYS = 24;
const LAST = addDays(FIRST, DAYS - 1);

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
});
afterAll(() => ctx.close());

const localTime = (day: string, hour: number) =>
  new Date(startOfLocalDay(day, TZ).getTime() + hour * HOUR);

type Company = Awaited<ReturnType<typeof createCompanyWithClient>>;

async function simulatedPlant(
  { company, client }: Company,
  scenarios: SimulationScenario[] = [],
  seed = 3,
) {
  const plant = await createPlant(ctx.owner, company.id, client.id);
  await ctx.owner.solarPlant.update({
    where: { id: plant.id },
    data: {
      simulationProfile: simulationProfileSchema.parse({
        seed,
        system_efficiency: 0.88,
        ac_limit_kw: 9,
        noise_pct: 1,
        scenarios,
      }),
    },
  });
  return plant;
}

/** Clima y telemetría de los DAYS días para las plantas de la empresa. */
async function ingest(companyId: string, plantIds: string[]) {
  const from = startOfLocalDay(FIRST, TZ);
  await ingestWeatherRange(ctx.jobContext(companyId), companyId, {
    from,
    to: startOfLocalDay(addDays(LAST, 1), TZ),
  });
  // El ingestor lee como mucho 7 días hacia atrás: se avanza el reloj de 6 en 6 días.
  for (let d = 6; d <= DAYS + 6; d += 6) {
    ctx.setNow(localTime(addDays(FIRST, Math.min(d, DAYS)), 0));
    for (const plantId of plantIds) {
      await runJob(
        ingestTelemetryPlantJob,
        { company_id: companyId, plant_id: plantId },
        0,
        ctx.deps,
      );
    }
  }
}

const metricsOf = (plantId: string) =>
  ctx.owner.plantDailyMetric.findMany({ where: { plantId }, orderBy: { date: 'asc' } });

const recompute = (companyId: string, from = FIRST, to = LAST) =>
  runJob(metricsRecomputeJob, { company_id: companyId, from, to }, 0, ctx.deps);

describe('metrics.recompute / metrics.daily_company', () => {
  it('calcula cada día con PR razonable y la línea base pasa de default a own', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c);
    await ingest(c.company.id, [plant.id]);

    expect(await recompute(c.company.id)).toBe('succeeded');
    const rows = await metricsOf(plant.id);
    expect(rows).toHaveLength(DAYS);
    expect(rows.every((r) => r.companyId === c.company.id && r.clientId === c.client.id)).toBe(
      true,
    );

    const valid = rows.filter((r) => r.isValidDay);
    expect(valid.length).toBeGreaterThan(DAYS / 2);
    for (const r of valid) {
      expect(Number(r.prTemp)).toBeGreaterThan(0.7);
      expect(Number(r.prTemp)).toBeLessThan(1);
      expect(Number(r.energyKwh)).toBeGreaterThan(0);
      expect(r.deviationPct).not.toBeNull();
      expect(r.status).not.toBe('no_data');
    }
    // Sin historia la base es la de omisión; con 10 días válidos previos, la propia.
    expect(rows[0]).toMatchObject({ baselineSource: 'default' });
    expect(Number(rows[0]!.prBaseline)).toBe(0.85);
    expect(rows.at(-1)!.baselineSource).toBe('own');
    // Sin vecinas en la empresa, no hay índice.
    expect(rows.every((r) => r.neighborIndex === null && r.neighborCount === 0)).toBe(true);
  });

  it('es idempotente: recalcular no duplica filas ni eventos y da los mismos valores', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c);
    await ingest(c.company.id, [plant.id]);
    await recompute(c.company.id);
    const first = await metricsOf(plant.id);
    const events = await ctx.owner.plantEvent.count({ where: { plantId: plant.id } });

    await recompute(c.company.id);
    const second = await metricsOf(plant.id);
    expect(second).toHaveLength(first.length);
    const strip = (rows: typeof first) =>
      rows.map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest);
    expect(strip(second)).toEqual(strip(first));
    expect(await ctx.owner.plantEvent.count({ where: { plantId: plant.id } })).toBe(events);
  });

  it('crea un único evento rain_cleaning automático cuando llueve lo suficiente', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c);
    await ingest(c.company.id, [plant.id]);
    const day = addDays(FIRST, 5);
    // Elimina la lluvia del clima sintético y fuerza 3 mm a las 15:00 locales del día 6.
    await ctx.owner.plantWeatherHourly.updateMany({
      where: { plantId: plant.id },
      data: { precipitationMm: 0 },
    });
    await ctx.owner.plantWeatherHourly.updateMany({
      where: { plantId: plant.id, ts: localTime(day, 15) },
      data: { precipitationMm: 3 },
    });

    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, day);
    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, day);
    const events = await ctx.owner.plantEvent.findMany({ where: { plantId: plant.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      companyId: c.company.id,
      type: 'rain_cleaning',
      source: 'auto',
      occurredAt: localTime(day, 16),
    });
  });

  it('predice el lavado con suciedad simulada y reinicia la tendencia tras una limpieza', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c, [
      { type: 'soiling', start: FIRST, rate_pct_per_day: 0.6 },
    ]);
    await ingest(c.company.id, [plant.id]);
    // Sin lluvia para que la tendencia no se reinicie.
    await ctx.owner.plantWeatherHourly.updateMany({
      where: { plantId: plant.id },
      data: { precipitationMm: 0 },
    });
    await recompute(c.company.id);
    const last = (await metricsOf(plant.id)).at(-1)!;
    expect(Number(last.soilingSlopePctPerDay)).toBeLessThan(-0.05);
    expect(last.predictionConfidence).not.toBeNull();
    expect(last.daysToCleaning).not.toBeNull();

    // Una limpieza registrada ayer deja menos de 7 puntos: sin predicción.
    await ctx.owner.plantEvent.create({
      data: {
        companyId: c.company.id,
        plantId: plant.id,
        type: 'cleaning',
        source: 'manual',
        occurredAt: localTime(addDays(LAST, -1), 10),
      },
    });
    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, LAST);
    const after = (await metricsOf(plant.id)).at(-1)!;
    expect(after).toMatchObject({
      soilingSlopePctPerDay: null,
      daysToCleaning: null,
      predictionConfidence: null,
    });
  });

  it('usa solo vecinas de la misma empresa (índice y línea base provisional)', async () => {
    const a = await createCompanyWithClient(ctx.owner);
    const b = await createCompanyWithClient(ctx.owner);
    const aPlants = [await simulatedPlant(a, [], 1), await simulatedPlant(a, [], 2)];
    const bPlants = [
      await simulatedPlant(b, [], 4),
      await simulatedPlant(b, [], 5),
      await simulatedPlant(b, [], 6),
    ];
    await ingest(
      a.company.id,
      aPlants.map((p) => p.id),
    );
    await ingest(
      b.company.id,
      bPlants.map((p) => p.id),
    );
    await recompute(a.company.id);
    await recompute(b.company.id);

    // A tiene 2 plantas: cada una tiene 1 vecina < mínimo 3 → sin índice, aunque B esté al lado.
    for (const p of aPlants) {
      const rows = await metricsOf(p.id);
      expect(rows.every((r) => r.neighborIndex === null && r.neighborCount === 0)).toBe(true);
    }
    // En B cada planta tiene solo 2 vecinas; con mínimo 2 sí hay índice y solo cuenta las suyas.
    await ctx.owner.company.update({
      where: { id: b.company.id },
      data: { settings: { thresholds: { neighbor_min_count: 2 } } },
    });
    await recompute(b.company.id, LAST, LAST);
    for (const p of bPlants) {
      const [row] = await ctx.owner.plantDailyMetric.findMany({
        where: { plantId: p.id, date: new Date(`${LAST}T00:00:00Z`) },
      });
      expect(row?.isValidDay).toBe(true);
      expect(row?.neighborCount).toBe(2);
      expect(Number(row?.neighborIndex)).toBeGreaterThan(0.9);
      expect(Number(row?.neighborIndex)).toBeLessThan(1.1);
    }

    // Una planta nueva de B sin historia toma la base de sus vecinas (todas de B).
    const fresh = await simulatedPlant(b, [], 7);
    await computeCompanyDay(ctx.jobContext(b.company.id), b.company.id, LAST);
    const [row] = await metricsOf(fresh.id);
    expect(row?.baselineSource).toBe('neighbors');
  });

  it('una planta sin telemetría queda sin datos válidos; no se calcula antes de su puesta en marcha', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const silent = await createPlant(ctx.owner, c.company.id, c.client.id);
    const future = await createPlant(ctx.owner, c.company.id, c.client.id);
    const paused = await createPlant(ctx.owner, c.company.id, c.client.id, { status: 'paused' });
    await ctx.owner.solarPlant.update({
      where: { id: future.id },
      data: { commissioningDate: new Date(`${addDays(LAST, 1)}T00:00:00Z`) },
    });
    await ingestWeatherRange(ctx.jobContext(c.company.id), c.company.id, {
      from: startOfLocalDay(LAST, TZ),
      to: startOfLocalDay(addDays(LAST, 1), TZ),
    });
    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, LAST);

    const [row] = await metricsOf(silent.id);
    expect(row).toMatchObject({ isValidDay: false, invalidReason: 'offline' });
    expect(row?.status).toBe('offline');
    expect(await metricsOf(future.id)).toHaveLength(0);
    expect(await metricsOf(paused.id)).toHaveLength(0);
  });

  it('un día no válido con PR calculable no tiene desviación', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c);
    await ingest(c.company.id, [plant.id]);
    // Irradiancia del último día al 5 %: queda por debajo del mínimo (low_irradiation).
    const hours = await ctx.owner.plantWeatherHourly.findMany({
      where: { plantId: plant.id, ts: { gte: startOfLocalDay(LAST, TZ) } },
    });
    for (const h of hours) {
      await ctx.owner.plantWeatherHourly.update({
        where: { plantId_ts: { plantId: h.plantId, ts: h.ts } },
        data: { poaWm2: Number(h.poaWm2) * 0.05 },
      });
    }
    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, LAST);
    const row = (await metricsOf(plant.id)).at(-1)!;
    expect(row).toMatchObject({ isValidDay: false, invalidReason: 'low_irradiation' });
    expect(row.prTemp).not.toBeNull();
    expect(row.deviationPct).toBeNull();
  });

  it('la tendencia de suciedad no cuenta el día del reinicio', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c, [
      { type: 'soiling', start: FIRST, rate_pct_per_day: 0.6 },
    ]);
    await ingest(c.company.id, [plant.id]);
    await ctx.owner.plantWeatherHourly.updateMany({
      where: { plantId: plant.id },
      data: { precipitationMm: 0 },
    });
    await recompute(c.company.id);
    const lastDays = (await metricsOf(plant.id)).slice(-7);
    expect(lastDays.every((r) => r.isValidDay)).toBe(true);

    // Limpieza hace 6 días: 6 días posteriores (< 7) → sin predicción, aunque el día de la
    // limpieza también sea válido.
    await ctx.owner.plantEvent.create({
      data: {
        companyId: c.company.id,
        plantId: plant.id,
        type: 'cleaning',
        source: 'manual',
        occurredAt: localTime(addDays(LAST, -6), 10),
      },
    });
    await computeCompanyDay(ctx.jobContext(c.company.id), c.company.id, LAST);
    expect((await metricsOf(plant.id)).at(-1)!.predictionConfidence).toBeNull();
  });

  it('los días con sudden_drop activo no entran en la línea base', async () => {
    const c = await createCompanyWithClient(ctx.owner);
    const plant = await simulatedPlant(c, [
      { type: 'string_failure', start: addDays(FIRST, 2), loss_pct: 50, end: null },
    ]);
    await ingest(c.company.id, [plant.id]);
    await ctx.owner.alert.create({
      data: {
        companyId: c.company.id,
        plantId: plant.id,
        type: 'sudden_drop',
        severity: 'critical',
        detectedAt: localTime(addDays(FIRST, 2), 20),
      },
    });
    await recompute(c.company.id);
    // Solo quedan 2 días sanos (< 10): la base es la de omisión y la caída se ve como desviación.
    const last = (await metricsOf(plant.id)).filter((r) => r.isValidDay).at(-1)!;
    expect(last.baselineSource).toBe('default');
    expect(Number(last.deviationPct)).toBeGreaterThan(40);
  });
});

describe('metrics.daily (orquestador)', () => {
  async function queuedFor(companyId: string) {
    const jobs = await ctx.queue.boss.fetch<{ company_id: string; date: string }>(
      'metrics.daily_company',
      { batchSize: 500 },
    );
    return jobs.filter((j) => j.data.company_id === companyId).map((j) => j.data.date);
  }

  it('encola cada empresa activa a las 22:00 de su hora local con su fecha local', async () => {
    const { metricsDailyCompany } = await import('@pv/adapters');
    await ctx.queue.ensureQueue(metricsDailyCompany);
    const { company } = await createCompanyWithClient(ctx.owner);
    const suspended = await createCompanyWithClient(ctx.owner, { status: 'suspended' });

    ctx.setNow(localTime('2026-10-21', 21));
    await runJob(metricsDailyJob, {}, 0, ctx.deps);
    expect(await queuedFor(company.id)).toEqual([]);

    ctx.setNow(localTime('2026-10-21', 22));
    await runJob(metricsDailyJob, {}, 0, ctx.deps);
    expect(await queuedFor(company.id)).toEqual(['2026-10-21']);
    expect(await queuedFor(suspended.company.id)).toEqual([]);
  });
});

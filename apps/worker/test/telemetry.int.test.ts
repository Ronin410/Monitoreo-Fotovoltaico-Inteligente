import {
  createAdapterRegistry,
  type InverterAdapter,
  type InverterAdapterRegistry,
} from '@pv/adapters';
import { simulationProfileSchema, startOfLocalDay, type SimulationScenario } from '@pv/core';
import type { PrismaClient } from '@pv/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestTelemetryJob, ingestTelemetryPlantJob } from '../src/jobs/telemetry.js';
import { ingestWeatherRange } from '../src/jobs/weather.js';
import { runJob } from '../src/runtime.js';
import { dbSimulatorSource } from '../src/simulator-source.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  TEST_CIPHER,
  type WorkerTestContext,
} from './helpers.js';

const TZ = 'America/Mazatlan';
const SECRET = 'Contraseña-Del-Portal-9931';
const received: unknown[] = [];

/** GoodWe de prueba que devuelve dos lecturas; Huawei de prueba que falla repitiendo la clave. */
function testAdapters(companyId: string, db: PrismaClient): InverterAdapterRegistry {
  const base = createAdapterRegistry({ simulator: dbSimulatorSource(db, companyId) });
  const goodwe: InverterAdapter = {
    provider: 'goodwe',
    testConnection: async () => ({ ok: true }),
    fetchReadings: async ({ creds, until }) => {
      received.push(creds);
      const t = new Date(Math.floor(until.getTime() / 900_000) * 900_000 - 900_000);
      return [
        { ts: new Date(t.getTime() - 900_000), powerKw: 3, energyTodayKwh: 10 },
        { ts: t, powerKw: 3.2, energyTodayKwh: 10.8 },
      ];
    },
  };
  const huawei: InverterAdapter = {
    provider: 'huawei',
    testConnection: async () => ({ ok: false }),
    fetchReadings: async ({ creds }) => {
      throw new Error(`login rechazado: ${(creds as { password: string }).password}`);
    },
  };
  return { ...base, goodwe, huawei };
}

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext(undefined, testAdapters);
});
afterAll(() => ctx.close());

const HOUR = 3_600_000;
const localTime = (day: string, hour: number) =>
  new Date(startOfLocalDay(day, TZ).getTime() + hour * HOUR);

async function simulatedPlant(scenarios: SimulationScenario[] = []) {
  const { company, client } = await createCompanyWithClient(ctx.owner);
  const plant = await createPlant(ctx.owner, company.id, client.id);
  await ctx.owner.solarPlant.update({
    where: { id: plant.id },
    data: {
      simulationProfile: simulationProfileSchema.parse({
        seed: 3,
        system_efficiency: 0.89,
        ac_limit_kw: 9,
        noise_pct: 0,
        scenarios,
      }),
    },
  });
  const from = startOfLocalDay('2026-10-10', TZ);
  await ingestWeatherRange(ctx.jobContext(company.id), company.id, {
    from,
    to: new Date(from.getTime() + 12 * 24 * HOUR),
  });
  return { company, plant };
}

const telemetryOf = (plantId: string) =>
  ctx.owner.telemetryReading.findMany({ where: { plantId }, orderBy: { ts: 'asc' } });

const runPlant = (companyId: string, plantId: string) =>
  runJob(ingestTelemetryPlantJob, { company_id: companyId, plant_id: plantId }, 0, ctx.deps);

describe('ingest.telemetry_plant con el simulador', () => {
  it('guarda intervalos de 15 min con energía del contador y actualiza la última lectura', async () => {
    const { company, plant } = await simulatedPlant();
    // Primera corrida: planta nueva, lee hasta 7 días atrás; ahora son las 12:00 del 20.
    ctx.setNow(localTime('2026-10-20', 12));
    expect(await runPlant(company.id, plant.id)).toBe('succeeded');

    const rows = await telemetryOf(plant.id);
    expect(rows.length).toBeGreaterThan(7 * 36);
    expect(rows[0]!.ts.getTime()).toBeGreaterThanOrEqual(localTime('2026-10-13', 12).getTime());
    expect(rows.every((r) => r.ts.getTime() % 900_000 === 0 && r.companyId === company.id)).toBe(
      true,
    );
    // Con contador diario la energía de cada intervalo es la diferencia (≈ potencia × 0.25 h).
    const midday = rows.filter((r) => r.ts.toISOString().startsWith('2026-10-19T19'));
    for (const r of midday) expect(Number(r.energyKwh)).toBeCloseTo(Number(r.powerKw) * 0.25, 3);

    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: plant.id } });
    expect(stored.lastReadingAt).toEqual(rows.at(-1)!.ts);
    expect(Number(stored.lastPowerKw)).toBeCloseTo(Number(rows.at(-1)!.powerKw), 4);

    const [run] = await ctx.owner.jobRun.findMany({
      where: { jobName: 'ingest.telemetry_plant', companyId: company.id },
    });
    expect(run).toMatchObject({ status: 'succeeded', stats: { plant_id: plant.id } });
  });

  it('es idempotente y la siguiente corrida solapa 1 hora', async () => {
    const { company, plant } = await simulatedPlant();
    ctx.setNow(localTime('2026-10-20', 12));
    await runPlant(company.id, plant.id);
    const before = await telemetryOf(plant.id);
    await runPlant(company.id, plant.id);
    expect(await telemetryOf(plant.id)).toHaveLength(before.length);

    ctx.setNow(localTime('2026-10-20', 13));
    await runPlant(company.id, plant.id);
    const after = await telemetryOf(plant.id);
    expect(after.length).toBe(before.length + 4);
    const [last] = await ctx.owner.jobRun.findMany({
      where: { jobName: 'ingest.telemetry_plant', companyId: company.id },
      orderBy: { startedAt: 'desc' },
      take: 1,
    });
    expect((last?.stats as { since: string }).since).toBe(
      new Date(before.at(-1)!.ts.getTime() - HOUR).toISOString(),
    );
  });

  it('una planta desconectada no guarda lecturas', async () => {
    const { company, plant } = await simulatedPlant([
      { type: 'offline', start: '2026-10-01T00:00:00Z', end: null },
    ]);
    ctx.setNow(localTime('2026-10-20', 12));
    expect(await runPlant(company.id, plant.id)).toBe('succeeded');
    expect(await telemetryOf(plant.id)).toHaveLength(0);
    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: plant.id } });
    expect(stored.lastReadingAt).toBeNull();
  });
});

describe('ingest.telemetry_plant con marcas reales', () => {
  async function realPlant(
    brand: 'goodwe' | 'huawei' | 'fronius' | 'growatt' | 'victron',
    withCreds = true,
  ) {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, company.id, client.id);
    await ctx.owner.solarPlant.update({ where: { id: plant.id }, data: { inverterBrand: brand } });
    if (withCreds) {
      const enc = TEST_CIPHER.encrypt(
        { username: 'u', password: SECRET },
        {
          companyId: company.id,
          plantId: plant.id,
        },
      );
      await ctx.owner.inverterCredential.create({
        data: { companyId: company.id, plantId: plant.id, provider: brand, ...enc },
      });
    }
    return { company, plant };
  }

  it('descifra las credenciales en memoria y se las pasa al adaptador', async () => {
    const { company, plant } = await realPlant('goodwe');
    ctx.setNow(localTime('2026-10-20', 12));
    expect(await runPlant(company.id, plant.id)).toBe('succeeded');
    expect(received.at(-1)).toEqual({ username: 'u', password: SECRET });
    const rows = await telemetryOf(plant.id);
    // El primer intervalo no tiene anterior: potencia × 0.25; el segundo, diferencia del contador.
    expect(rows.map((r) => Number(r.energyKwh))).toEqual([0.75, 0.8]);
  });

  it('sin credenciales se omite', async () => {
    const { company, plant } = await realPlant('goodwe', false);
    await runPlant(company.id, plant.id);
    const [run] = await ctx.owner.jobRun.findMany({ where: { companyId: company.id } });
    expect(run).toMatchObject({ status: 'succeeded', stats: { skipped: 'no_credentials' } });
  });

  it('un error del proveedor falla con provider_error sin su mensaje (para reintentar)', async () => {
    const { company, plant } = await realPlant('huawei');
    await expect(runPlant(company.id, plant.id)).rejects.toThrow(/^provider_error: /);
    const [run] = await ctx.owner.jobRun.findMany({ where: { companyId: company.id } });
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('ProviderError: provider_error: Error');
    expect(JSON.stringify(run)).not.toContain(SECRET);
    expect(await telemetryOf(plant.id)).toHaveLength(0);
  });

  it('una marca sin adaptador se omite sin fallar ni reintentar', async () => {
    for (const brand of ['growatt', 'victron', 'fronius'] as const) {
      const { company, plant } = await realPlant(brand);
      expect(await runPlant(company.id, plant.id)).toBe('succeeded');
      const [run] = await ctx.owner.jobRun.findMany({ where: { companyId: company.id } });
      expect(run).toMatchObject({
        status: 'succeeded',
        stats: { skipped: 'adapter_not_implemented' },
      });
      expect(JSON.stringify(run)).not.toContain(SECRET);
      expect(await telemetryOf(plant.id)).toHaveLength(0);
    }
  });
});

describe('ingest.telemetry (orquestador)', () => {
  async function queuedPlantIds(): Promise<string[]> {
    const jobs = await ctx.queue.boss.fetch<{ plant_id: string }>('ingest.telemetry_plant', {
      batchSize: 500,
    });
    return jobs.map((j) => j.data.plant_id);
  }

  it('solo encola plantas activas, con ubicación, de empresas activas y con sol', async () => {
    await ctx.queue.ensureQueue(ingestTelemetryPlantJob.definition);
    const a = await createCompanyWithClient(ctx.owner);
    const suspended = await createCompanyWithClient(ctx.owner, { status: 'suspended' });
    const active = await createPlant(ctx.owner, a.company.id, a.client.id);
    const paused = await createPlant(ctx.owner, a.company.id, a.client.id, { status: 'paused' });
    const noLocation = await createPlant(ctx.owner, a.company.id, a.client.id, {
      lat: null,
      lon: null,
    });
    const ofSuspended = await createPlant(ctx.owner, suspended.company.id, suspended.client.id);

    // De noche (02:00 locales) no se encola nada de esta empresa.
    ctx.setNow(localTime('2026-10-21', 2));
    await runJob(ingestTelemetryJob, {}, 0, ctx.deps);
    expect(await queuedPlantIds()).not.toContain(active.id);

    ctx.setNow(localTime('2026-10-21', 12));
    await runJob(ingestTelemetryJob, {}, 0, ctx.deps);
    const queued = await queuedPlantIds();
    expect(queued).toContain(active.id);
    for (const p of [paused, noLocation, ofSuspended]) expect(queued).not.toContain(p.id);
  });
});

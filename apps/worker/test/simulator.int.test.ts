import { createAdapterRegistry, type PlantForAdapter } from '@pv/adapters';
import { simulationProfileSchema, startOfLocalDay, sunPosition } from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestWeatherRange } from '../src/jobs/weather.js';
import { dbSimulatorSource } from '../src/simulator-source.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
});
afterAll(() => ctx.close());

const TZ = 'America/Mazatlan';
const profile = simulationProfileSchema.parse({
  seed: 7,
  system_efficiency: 0.89,
  ac_limit_kw: 9,
  noise_pct: 0,
  scenarios: [{ type: 'soiling', start: '2026-10-01', rate_pct_per_day: 1 }],
});

async function simulatedPlant() {
  const { company, client } = await createCompanyWithClient(ctx.owner);
  const plant = await createPlant(ctx.owner, company.id, client.id);
  await ctx.owner.solarPlant.update({
    where: { id: plant.id },
    data: { simulationProfile: profile },
  });
  // Clima del 1 al 10 de octubre.
  const from = startOfLocalDay('2026-10-01', TZ);
  await ingestWeatherRange(ctx.jobContext(company.id), company.id, {
    from,
    to: new Date(from.getTime() + 10 * 24 * 3_600_000),
  });
  const forAdapter: PlantForAdapter = {
    id: plant.id,
    capacityKwp: 5,
    serial: null,
    lat: 24.8,
    lon: -107.39,
    simulationProfile: profile,
    noctC: 45,
    gammaPctPerC: -0.4,
    timezone: TZ,
  };
  return { company, plant, forAdapter };
}

const dayRange = (day: string) => {
  const from = startOfLocalDay(day, TZ);
  return { since: from, until: new Date(from.getTime() + 24 * 3_600_000) };
};

describe('adaptador simulator con datos de la base', () => {
  it('genera lecturas con el clima guardado, solo con sol', async () => {
    const { company, forAdapter } = await simulatedPlant();
    const adapter = createAdapterRegistry({
      simulator: dbSimulatorSource(ctx.db, company.id),
    }).simulator;
    const readings = await adapter.fetchReadings({
      plant: forAdapter,
      creds: {},
      ...dayRange('2026-10-05'),
    });
    expect(readings.length).toBeGreaterThan(40);
    for (const r of readings) {
      expect(r.powerKw).toBeGreaterThan(0);
      const mid = new Date(r.ts.getTime() + 7.5 * 60_000);
      expect(sunPosition(mid, 24.8, -107.39).elevationDeg).toBeGreaterThan(-1);
    }
  });

  it('una limpieza registrada en plant_events reinicia la suciedad', async () => {
    const { company, plant, forAdapter } = await simulatedPlant();
    const adapter = createAdapterRegistry({
      simulator: dbSimulatorSource(ctx.db, company.id),
    }).simulator;
    const energy = async () =>
      (
        await adapter.fetchReadings({ plant: forAdapter, creds: {}, ...dayRange('2026-10-09') })
      ).reduce((s, r) => s + r.powerKw * 0.25, 0);
    const dirty = await energy();
    await ctx.owner.plantEvent.create({
      data: {
        companyId: company.id,
        plantId: plant.id,
        type: 'cleaning',
        source: 'manual',
        occurredAt: startOfLocalDay('2026-10-09', TZ),
      },
    });
    const washed = await energy();
    // Tras ~8 días al 1 %/día, lavar recupera ~8 % (salvo que haya llovido en esos días).
    expect(washed).toBeGreaterThan(dirty);
  });

  it('el registro sin fuente no puede simular (la api solo prueba conexión)', async () => {
    const { forAdapter } = await simulatedPlant();
    const adapter = createAdapterRegistry().simulator;
    await expect(adapter.testConnection({})).resolves.toEqual({ ok: true });
    await expect(
      adapter.fetchReadings({ plant: forAdapter, creds: {}, ...dayRange('2026-10-05') }),
    ).rejects.toThrow(/fuente de datos/);
  });
});

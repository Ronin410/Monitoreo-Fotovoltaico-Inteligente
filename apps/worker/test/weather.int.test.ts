import { SyntheticWeatherProvider, type WeatherRequest } from '@pv/adapters';
import { startOfLocalDay, sunPosition } from '@pv/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hourlyRange,
  ingestWeatherRange,
  ingestWeatherCompanyJob,
  ingestWeatherJob,
  weatherBackfillJob,
} from '../src/jobs/weather.js';
import { runJob } from '../src/runtime.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

/** Proveedor sintético que cuenta las llamadas. */
class CountingWeather extends SyntheticWeatherProvider {
  calls: WeatherRequest[] = [];
  override async fetchHourly(req: WeatherRequest) {
    this.calls.push(req);
    return super.fetchHourly(req);
  }
}

const weather = new CountingWeather();
let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext(weather);
});
afterAll(() => ctx.close());

const localDay = (date: string) => {
  const from = startOfLocalDay(date, 'America/Mazatlan');
  return { from, to: new Date(from.getTime() + 24 * 3_600_000) };
};

const hoursOf = (plantId: string) =>
  ctx.owner.plantWeatherHourly.findMany({ where: { plantId }, orderBy: { ts: 'asc' } });

describe('CA F3-T2: planta en Culiacán, 20° al sur', () => {
  it('guarda 24 horas con POA > 0 solo en las horas de sol', async () => {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, company.id, client.id, {
      tiltDeg: 20,
      azimuthDeg: 180,
    });

    const stats = await ingestWeatherRange(
      ctx.jobContext(company.id),
      company.id,
      localDay('2026-10-20'),
    );
    expect(stats).toMatchObject({ plants: 1, provider_calls: 1, hours_stored: 24 });

    const rows = await hoursOf(plant.id);
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.companyId === company.id && r.source === 'synthetic')).toBe(true);
    for (const r of rows) {
      const mid = new Date(r.ts.getTime() + 1_800_000);
      const sunUp = sunPosition(mid, 24.8, -107.39).elevationDeg > 0;
      expect(Number(r.poaWm2) > 0, r.ts.toISOString()).toBe(sunUp);
    }
    const sunny = rows.filter((r) => Number(r.poaWm2) > 0).length;
    expect(sunny).toBeGreaterThanOrEqual(11);
    expect(sunny).toBeLessThanOrEqual(13);
  });
});

describe('ingesta de clima', () => {
  it('es idempotente: repetir el rango no duplica filas', async () => {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, company.id, client.id);
    await ingestWeatherRange(ctx.jobContext(company.id), company.id, localDay('2026-10-19'));
    await ingestWeatherRange(ctx.jobContext(company.id), company.id, localDay('2026-10-19'));
    expect(await hoursOf(plant.id)).toHaveLength(24);
  });

  it('agrupa plantas con la misma ubicación y orientación en una sola llamada', async () => {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const a = await createPlant(ctx.owner, company.id, client.id);
    const b = await createPlant(ctx.owner, company.id, client.id, { lat: 24.8004, lon: -107.3903 });
    const c = await createPlant(ctx.owner, company.id, client.id, { tiltDeg: 10 });
    weather.calls = [];
    const stats = await ingestWeatherRange(
      ctx.jobContext(company.id),
      company.id,
      localDay('2026-10-18'),
    );
    expect(stats).toMatchObject({ plants: 3, provider_calls: 2 });
    expect(weather.calls).toHaveLength(2);
    for (const p of [a, b, c]) expect(await hoursOf(p.id)).toHaveLength(24);
    // Comparten clima pero la inclinación distinta da otra irradiancia.
    const [ra, rb, rc] = await Promise.all([a, b, c].map((p) => hoursOf(p.id)));
    expect(rb?.map((r) => Number(r.poaWm2))).toEqual(ra?.map((r) => Number(r.poaWm2)));
    expect(rc?.map((r) => Number(r.poaWm2))).not.toEqual(ra?.map((r) => Number(r.poaWm2)));
  });

  it('omite plantas pausadas, borradas o sin ubicación, y no toca otras empresas', async () => {
    const a = await createCompanyWithClient(ctx.owner);
    const b = await createCompanyWithClient(ctx.owner);
    const active = await createPlant(ctx.owner, a.company.id, a.client.id);
    const paused = await createPlant(ctx.owner, a.company.id, a.client.id, { status: 'paused' });
    const deleted = await createPlant(ctx.owner, a.company.id, a.client.id, {
      deletedAt: new Date(),
    });
    const noLocation = await createPlant(ctx.owner, a.company.id, a.client.id, {
      lat: null,
      lon: null,
    });
    const ofB = await createPlant(ctx.owner, b.company.id, b.client.id);

    const stats = await ingestWeatherRange(
      ctx.jobContext(a.company.id),
      a.company.id,
      localDay('2026-10-17'),
    );
    expect(stats.plants).toBe(1);
    expect(await hoursOf(active.id)).toHaveLength(24);
    for (const p of [paused, deleted, noLocation, ofB]) expect(await hoursOf(p.id)).toHaveLength(0);
  });
});

describe('rango de la corrida horaria', () => {
  it('pide las últimas 3 horas cerradas', () => {
    const r = hourlyRange(new Date('2026-10-21T19:05:00Z'), 'America/Mazatlan'); // 12:05 local
    expect(r).toEqual({
      from: new Date('2026-10-21T16:00:00Z'),
      to: new Date('2026-10-21T19:00:00Z'),
    });
  });

  it('a las 21:00 locales vuelve a pedir el día completo', () => {
    const r = hourlyRange(new Date('2026-10-22T04:05:00Z'), 'America/Mazatlan'); // 21:05 local
    expect(r).toEqual({
      from: new Date('2026-10-21T07:00:00Z'),
      to: new Date('2026-10-22T04:00:00Z'),
    });
  });
});

describe('jobs', () => {
  it('ingest.weather_company guarda las horas del rango en la zona de la empresa', async () => {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, company.id, client.id);
    const outcome = await runJob(
      ingestWeatherCompanyJob,
      { company_id: company.id, at: '2026-10-21T19:05:00.000Z' },
      0,
      ctx.deps,
    );
    expect(outcome).toBe('succeeded');
    const rows = await hoursOf(plant.id);
    expect(rows.map((r) => r.ts.toISOString())).toEqual([
      '2026-10-21T16:00:00.000Z',
      '2026-10-21T17:00:00.000Z',
      '2026-10-21T18:00:00.000Z',
    ]);
  });

  it('weather.backfill guarda los últimos N días de una planta', async () => {
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, company.id, client.id);
    const other = await createPlant(ctx.owner, company.id, client.id);
    ctx.setNow(new Date('2026-10-21T19:30:00Z'));
    expect(
      await runJob(
        weatherBackfillJob,
        { company_id: company.id, plant_id: plant.id, days: 90 },
        0,
        ctx.deps,
      ),
    ).toBe('succeeded');
    const rows = await hoursOf(plant.id);
    expect(rows).toHaveLength(90 * 24);
    expect(rows.at(-1)?.ts.toISOString()).toBe('2026-10-21T18:00:00.000Z');
    expect(await hoursOf(other.id)).toHaveLength(0);
  });

  it('ingest.weather encola una corrida por empresa activa', async () => {
    const active = await createCompanyWithClient(ctx.owner);
    const suspended = await createCompanyWithClient(ctx.owner, { status: 'suspended' });
    await ctx.queue.ensureQueue(ingestWeatherCompanyJob.definition);
    ctx.setNow(new Date('2026-10-21T20:05:00Z'));
    await runJob(ingestWeatherJob, {}, 0, ctx.deps);

    const queued = await ctx.queue.boss.fetch<{ company_id: string; at: string }>(
      'ingest.weather_company',
      {
        batchSize: 100,
      },
    );
    const companies = queued.map((j) => j.data.company_id);
    expect(companies).toContain(active.company.id);
    expect(companies).not.toContain(suspended.company.id);
    expect(queued.find((j) => j.data.company_id === active.company.id)?.data.at).toBe(
      '2026-10-21T20:00:00.000Z',
    );
  });
});

import type { UserRole } from '@pv/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  // 11:00 del 22 de octubre en Culiacán (UTC−7).
  ctx.clock.current = new Date('2026-10-22T18:00:00Z');
});
afterAll(() => ctx.close());

async function fleet() {
  const company = await createCompany(ctx.owner);
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: 'C',
      address: 'x',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const plant = await ctx.owner.solarPlant.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: 'Planta',
      capacityKwp: 5,
      tiltDeg: 20,
      azimuthDeg: 180,
      noctC: 45,
      gammaPctPerC: -0.4,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const user = async (role: UserRole) => {
    const u = await createUser(ctx.owner, { companyId: company.id, role });
    return { id: u.id, auth: `Bearer ${await tokenFor(u, ctx.clock.current)}` };
  };
  return { company, client, plant, user };
}
type Fleet = Awaited<ReturnType<typeof fleet>>;

const get = (auth: string, path: string) =>
  request(ctx.app).get(`/api/plants${path}`).set('Authorization', auth);

async function metric(f: Fleet, date: string, over: object = {}) {
  await ctx.owner.plantDailyMetric.create({
    data: {
      companyId: f.company.id,
      plantId: f.plant.id,
      date: new Date(`${date}T00:00:00Z`),
      clientId: f.client.id,
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 20,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 25,
      expectedTempKwh: 23,
      specificYieldKwhKwp: 4,
      prTemp: 0.86,
      prBaseline: 0.9,
      isValidDay: true,
      status: 'ok',
      ...over,
    },
  });
}

describe('GET /plants/:id/today', () => {
  it('potencia real cada 15 min y esperada con el clima y la línea base', async () => {
    const f = await fleet();
    await metric(f, '2026-10-21', { prBaseline: 0.8 });
    // 12:00 locales = 19:00 UTC. Caso A de specs/05: G 900, T 38 → E_exp 3.75975 kWh (5 kWp).
    await ctx.owner.plantWeatherHourly.create({
      data: {
        companyId: f.company.id,
        plantId: f.plant.id,
        ts: new Date('2026-10-22T19:00:00Z'),
        poaWm2: 900,
        ghiWm2: 800,
        tempAmbC: 38,
        cloudCoverPct: 5,
        precipitationMm: 0,
        source: 'synthetic',
      },
    });
    await ctx.owner.telemetryReading.create({
      data: {
        companyId: f.company.id,
        plantId: f.plant.id,
        ts: new Date('2026-10-22T19:15:00Z'),
        powerKw: 3.1,
        energyKwh: 0.775,
      },
    });
    const res = await get((await f.user('operator')).auth, `/${f.plant.id}/today`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: '2026-10-22',
      timezone: 'America/Mazatlan',
      baseline_pr: 0.8,
    });
    expect(res.body.intervals).toHaveLength(96);
    const at = (iso: string) => res.body.intervals.find((i: { ts: string }) => i.ts === iso);
    expect(at('2026-10-22T19:00:00.000Z')).toEqual({
      ts: '2026-10-22T19:00:00.000Z',
      power_kw: null,
      expected_kw: 3.008,
    });
    expect(at('2026-10-22T19:15:00.000Z')).toEqual({
      ts: '2026-10-22T19:15:00.000Z',
      power_kw: 3.1,
      expected_kw: 3.008,
    });
    expect(at('2026-10-22T20:00:00.000Z')).toMatchObject({ power_kw: null, expected_kw: null });
    // Sin línea base, se usa 0.85.
    const other = await fleet();
    expect(
      (await get((await other.user('operator')).auth, `/${other.plant.id}/today?date=2026-10-20`))
        .body,
    ).toMatchObject({
      date: '2026-10-20',
      baseline_pr: 0.85,
    });
  });

  it('el técnico solo con un ticket abierto de esa planta', async () => {
    const f = await fleet();
    const tech = await f.user('technician');
    expect((await get(tech.auth, `/${f.plant.id}/today`)).status).toBe(404);
    const ticket = await ctx.owner.maintenanceTicket.create({
      data: {
        companyId: f.company.id,
        plantId: f.plant.id,
        type: 'cleaning',
        title: 'Lavado',
        assignedToId: tech.id,
      },
    });
    expect((await get(tech.auth, `/${f.plant.id}/today`)).status).toBe(200);
    // Las métricas históricas y el resto de /plants siguen cerrados para el técnico.
    expect((await get(tech.auth, `/${f.plant.id}/daily-metrics`)).status).toBe(403);
    expect((await get(tech.auth, `/${f.plant.id}`)).status).toBe(403);
    await ctx.owner.maintenanceTicket.update({
      where: { id: ticket.id },
      data: { status: 'resolved' },
    });
    expect((await get(tech.auth, `/${f.plant.id}/today`)).status).toBe(404);
  });
});

describe('GET /plants/:id/daily-metrics', () => {
  it('por omisión los 30 días hasta ayer, con los eventos que reinician la tendencia', async () => {
    const f = await fleet();
    await metric(f, '2026-09-21'); // fuera: los 30 días son del 22 de septiembre al 21 de octubre
    await metric(f, '2026-09-22', { deviationPct: 2 });
    await metric(f, '2026-10-21', {
      rainMm: 4.5,
      isValidDay: false,
      invalidReason: 'low_irradiation',
    });
    await metric(f, '2026-10-22'); // hoy: aún no cuenta
    await ctx.owner.plantEvent.createMany({
      data: [
        {
          companyId: f.company.id,
          plantId: f.plant.id,
          type: 'rain_cleaning',
          source: 'auto',
          occurredAt: new Date('2026-10-21T22:00:00Z'),
        },
        {
          companyId: f.company.id,
          plantId: f.plant.id,
          type: 'note',
          source: 'manual',
          occurredAt: new Date('2026-10-10T18:00:00Z'),
        },
      ],
    });
    const res = await get((await f.user('operator')).auth, `/${f.plant.id}/daily-metrics`);
    expect(res.body).toMatchObject({
      from: '2026-09-22',
      to: '2026-10-21',
      soiling_deviation_pct: 12,
    });
    expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-09-22',
      '2026-10-21',
    ]);
    expect(res.body.days[1]).toMatchObject({
      rain_mm: 4.5,
      is_valid_day: false,
      invalid_reason: 'low_irradiation',
      pr_baseline: 0.9,
    });
    // 22:00 UTC del 21 = 15:00 locales del 21. Las notas no se incluyen.
    expect(res.body.events).toEqual([
      { type: 'rain_cleaning', date: '2026-10-21', source: 'auto' },
    ]);
  });

  it('rango a la medida, máximo 366 días; 404 entre empresas', async () => {
    const f = await fleet();
    const auth = (await f.user('company_admin')).auth;
    await metric(f, '2026-01-15');
    expect(
      (await get(auth, `/${f.plant.id}/daily-metrics?from=2026-01-01&to=2026-01-31`)).body.days,
    ).toHaveLength(1);
    expect(
      (await get(auth, `/${f.plant.id}/daily-metrics?from=2025-01-01&to=2026-01-31`)).status,
    ).toBe(400);
    expect(
      (await get(auth, `/${f.plant.id}/daily-metrics?from=2026-02-01&to=2026-01-01`)).status,
    ).toBe(400);
    const other = await fleet();
    expect((await get(auth, `/${other.plant.id}/daily-metrics`)).status).toBe(404);
    expect((await get(auth, `/${other.plant.id}/today`)).status).toBe(404);
  });
});

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
  // 11:00 del 22 de octubre en Culiacán.
  ctx.clock.current = new Date('2026-10-22T18:00:00Z');
});
afterAll(() => ctx.close());

async function fleet() {
  const company = await createCompany(ctx.owner);
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: 'Cliente',
      address: 'x',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const plant = (name: string, over: object = {}) =>
    ctx.owner.solarPlant.create({
      data: {
        companyId: company.id,
        clientId: client.id,
        name,
        capacityKwp: 10,
        tiltDeg: 20,
        azimuthDeg: 180,
        inverterBrand: 'simulator',
        postalCode: '80000',
        colonia: 'Centro',
        lat: 24.8,
        lon: -107.39,
        ...over,
      },
    });
  const auth = async (role: UserRole) =>
    `Bearer ${await tokenFor(await createUser(ctx.owner, { companyId: company.id, role }), ctx.clock.current)}`;
  return { company, client, plant, auth };
}
type Fleet = Awaited<ReturnType<typeof fleet>>;

async function metric(f: Fleet, plantId: string, date: string, over: object = {}) {
  await ctx.owner.plantDailyMetric.create({
    data: {
      companyId: f.company.id,
      plantId,
      date: new Date(`${date}T00:00:00Z`),
      clientId: f.client.id,
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 40,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 50,
      expectedTempKwh: 46,
      specificYieldKwhKwp: 4,
      prTemp: 0.87,
      isValidDay: true,
      status: 'ok',
      ...over,
    },
  });
}

const alert = (
  f: Fleet,
  plantId: string,
  type: 'offline' | 'sudden_drop' | 'soiling' | 'cleaning_due_soon',
  severity: 'info' | 'warning' | 'critical',
  status: 'open' | 'resolved' = 'open',
) => ctx.owner.alert.create({ data: { companyId: f.company.id, plantId, type, severity, status } });

const get = (auth: string, path: string) =>
  request(ctx.app).get(`/api/dashboard${path}`).set('Authorization', auth);

describe('tablero', () => {
  it('resumen: plantas, energía de hoy y del mes, PR de 7 días, alertas y offline', async () => {
    const f = await fleet();
    const a = await f.plant('A');
    const b = await f.plant('B', { capacityKwp: 25.5 });
    await f.plant('Pausada', { status: 'paused' });
    await f.plant('Borrada', { deletedAt: new Date() });
    // Del mes: 1 y 21 de octubre (el 30 de septiembre no cuenta).
    await metric(f, a.id, '2026-09-30', { energyKwh: 999 });
    await metric(f, a.id, '2026-10-01', { energyKwh: 30, prTemp: 0.5 });
    await metric(f, a.id, '2026-10-21', { energyKwh: 40, prTemp: 0.9 });
    await metric(f, b.id, '2026-10-20', { energyKwh: 60, prTemp: 0.8 });
    await metric(f, b.id, '2026-10-19', { energyKwh: 10, prTemp: 0.1, isValidDay: false });
    // Telemetría de hoy (desde las 00:00 locales = 07:00 UTC); la de ayer no cuenta.
    for (const [ts, e] of [
      ['2026-10-22T06:45:00Z', 100],
      ['2026-10-22T15:00:00Z', 1.5],
      ['2026-10-22T15:15:00Z', 2],
    ] as const) {
      await ctx.owner.telemetryReading.create({
        data: {
          companyId: f.company.id,
          plantId: a.id,
          ts: new Date(ts),
          powerKw: 6,
          energyKwh: e,
        },
      });
    }
    await alert(f, a.id, 'offline', 'critical');
    await alert(f, b.id, 'soiling', 'warning');
    await alert(f, b.id, 'cleaning_due_soon', 'info');
    await alert(f, b.id, 'sudden_drop', 'critical', 'resolved');

    const res = await get(await f.auth('operator'), '/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: '2026-10-22',
      timezone: 'America/Mazatlan',
      plants: { active: 2, capacity_kwp: 35.5, clients: 1 },
      energy_today_kwh: 3.5,
      energy_month_kwh: 30 + 40 + 60 + 10 + 3.5,
      pr_temp_7d: expect.closeTo((0.9 + 0.8) / 2, 6),
      alerts_open: { critical: 1, warning: 1, info: 1 },
      offline_plants: 1,
    });
  });

  it('mapa: estado actual según alertas abiertas y el último día calculado', async () => {
    const f = await fleet();
    const ok = await f.plant('1 Bien');
    const dirty = await f.plant('2 Sucia');
    const off = await f.plant('3 Sin datos');
    const old = await f.plant('4 Sin métricas recientes');
    await f.plant('5 Sin ubicación', { lat: null, lon: null });
    await metric(f, ok.id, '2026-10-21');
    await metric(f, dirty.id, '2026-10-21', { status: 'warning' });
    await alert(f, off.id, 'offline', 'critical');
    await metric(f, old.id, '2026-10-10');

    const res = await get(await f.auth('company_admin'), '/map');
    expect(
      res.body.plants.map((p: { name: string; status: string }) => `${p.name}:${p.status}`),
    ).toEqual([
      '1 Bien:ok',
      '2 Sucia:warning',
      '3 Sin datos:offline',
      '4 Sin métricas recientes:no_data',
    ]);
    expect(res.body.plants[0]).toMatchObject({
      client_name: 'Cliente',
      lat: 24.8,
      lon: -107.39,
      capacity_kwp: 10,
    });
  });

  it('próximos lavados: ≤ días pedidos, del último día reciente, sin caídas bruscas abiertas', async () => {
    const f = await fleet();
    const soon = await f.plant('Pronto');
    const now = await f.plant('Ya');
    const far = await f.plant('Lejos');
    const stale = await f.plant('Dato viejo');
    const dropped = await f.plant('Con falla');
    await metric(f, soon.id, '2026-10-21', {
      daysToCleaning: 5,
      predictionConfidence: 'medium',
      deviationPct: 8,
    });
    await metric(f, now.id, '2026-10-21', {
      daysToCleaning: 0,
      predictionConfidence: 'high',
      deviationPct: 14,
    });
    await metric(f, far.id, '2026-10-21', { daysToCleaning: 30 });
    await metric(f, stale.id, '2026-10-12', { daysToCleaning: 2 });
    await metric(f, dropped.id, '2026-10-21', { daysToCleaning: 0 });
    await alert(f, dropped.id, 'sudden_drop', 'warning');

    const auth = await f.auth('operator');
    const res = await get(auth, '/upcoming-cleanings');
    expect(res.body.days).toBe(14);
    expect(res.body.plants.map((p: { name: string }) => p.name)).toEqual(['Ya', 'Pronto']);
    expect(res.body.plants[1]).toMatchObject({
      days_to_cleaning: 5,
      confidence: 'medium',
      deviation_pct: 8,
      date: '2026-10-21',
    });
    expect((await get(auth, '/upcoming-cleanings?days=60')).body.plants).toHaveLength(3);
    expect((await get(auth, '/upcoming-cleanings?days=0')).status).toBe(400);
  });

  it('mejores y peores: promedio de días válidos, mínimo 5 días y sin repetir plantas', async () => {
    const f = await fleet();
    const prs = [0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.6];
    const plants = [];
    for (const [i, pr] of prs.entries()) {
      const p = await f.plant(`P${i}`);
      plants.push(p);
      for (let d = 10; d <= 15; d++) await metric(f, p.id, `2026-10-${d}`, { prTemp: pr });
    }
    const few = await f.plant('Pocos días');
    for (let d = 10; d <= 13; d++) await metric(f, few.id, `2026-10-${d}`, { prTemp: 0.99 });
    await metric(f, plants[6]!.id, '2026-10-16', { prTemp: 0.99, isValidDay: false });

    const res = await get(await f.auth('operator'), '/top-bottom');
    expect(res.body.best.map((p: { name: string }) => p.name)).toEqual([
      'P0',
      'P1',
      'P2',
      'P3',
      'P4',
    ]);
    expect(res.body.worst.map((p: { name: string }) => p.name)).toEqual(['P6', 'P5']);
    expect(res.body.worst[0]).toMatchObject({ pr_temp_avg: 0.6, valid_days: 6 });
    // Fuera de la ventana de 7 días (15 al 21 de octubre) solo queda 1 día válido: nadie entra.
    expect((await get(await f.auth('operator'), '/top-bottom?days=7')).body.best).toEqual([]);
  });

  it('el técnico no ve el tablero y los datos de otra empresa no cuentan', async () => {
    const a = await fleet();
    const b = await fleet();
    const pb = await b.plant('De B');
    await metric(b, pb.id, '2026-10-21', { daysToCleaning: 1 });
    await alert(b, pb.id, 'offline', 'critical');

    expect((await get(await a.auth('technician'), '/summary')).status).toBe(403);
    const auth = await a.auth('operator');
    expect((await get(auth, '/summary')).body).toMatchObject({
      plants: { active: 0 },
      alerts_open: { critical: 0 },
      offline_plants: 0,
    });
    expect((await get(auth, '/map')).body.plants).toEqual([]);
    expect((await get(auth, '/upcoming-cleanings')).body.plants).toEqual([]);
  });
});

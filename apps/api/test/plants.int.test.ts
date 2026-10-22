import type { UserRole } from '@pv/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const simulationProfile = {
  seed: 1234,
  system_efficiency: 0.89,
  ac_limit_kw: 9,
  noise_pct: 2,
  scenarios: [{ type: 'soiling', start: '2026-08-01', rate_pct_per_day: 0.35 }],
};

async function session(role: UserRole = 'operator', settings: object = {}) {
  const company = await ctx.owner.company.create({
    data: { name: 'Empresa', slug: `plants-${Date.now()}-${Math.random()}`, settings },
  });
  const user = await createUser(ctx.owner, { companyId: company.id, role });
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: 'Cliente Las Quintas',
      address: 'Calle 1',
      colonia: 'Las Quintas',
      postalCode: '80060',
      lat: 24.7957,
      lon: -107.4012,
    },
  });
  return { company, user, client, auth: `Bearer ${await tokenFor(user, ctx.clock.current)}` };
}

const api = (auth: string) => ({
  list: (query = '') => request(ctx.app).get(`/api/plants${query}`).set('Authorization', auth),
  create: (body: object) =>
    request(ctx.app).post('/api/plants').set('Authorization', auth).send(body),
  get: (id: string) => request(ctx.app).get(`/api/plants/${id}`).set('Authorization', auth),
  patch: (id: string, body: object) =>
    request(ctx.app).patch(`/api/plants/${id}`).set('Authorization', auth).send(body),
  remove: (id: string) => request(ctx.app).delete(`/api/plants/${id}`).set('Authorization', auth),
});

const minimal = (clientId: string) => ({
  client_id: clientId,
  name: 'Casa Familia Ruiz',
  capacity_kwp: 6.5,
  inverter_brand: 'goodwe',
});

describe('permisos', () => {
  it('technician y superadmin no gestionan plantas', async () => {
    const { client } = await session();
    const tech = await session('technician');
    expect((await api(tech.auth).list()).status).toBe(403);
    expect((await api(tech.auth).create(minimal(client.id))).status).toBe(403);
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    expect(
      (await api(`Bearer ${await tokenFor(superadmin, ctx.clock.current)}`).list()).status,
    ).toBe(403);
  });
});

describe('POST /api/plants', () => {
  it('aplica los valores por defecto de la empresa y copia la ubicación del cliente', async () => {
    const { client, auth } = await session('operator', {
      defaults: { tilt_deg: 15, azimuth_deg: 170 },
    });
    const res = await api(auth).create(minimal(client.id));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      client: { id: client.id, name: 'Cliente Las Quintas' },
      name: 'Casa Familia Ruiz',
      capacity_kwp: 6.5,
      tilt_deg: 15,
      azimuth_deg: 170,
      noct_c: 45,
      gamma_pct_per_c: -0.4,
      inverter_brand: 'goodwe',
      lat: 24.7957,
      lon: -107.4012,
      postal_code: '80060',
      colonia: 'Las Quintas',
      status: 'active',
      simulation_profile: null,
      last_reading_at: null,
    });
  });

  it('los valores indicados ganan sobre los de la empresa y del cliente', async () => {
    const { client, auth } = await session();
    const res = await api(auth).create({
      ...minimal(client.id),
      tilt_deg: 10,
      azimuth_deg: 90,
      noct_c: 42,
      gamma_pct_per_c: -0.35,
      lat: 24.81,
      lon: -107.38,
      postal_code: '80000',
      colonia: 'Centro',
      commissioning_date: '2026-03-15',
      panel_count: 12,
      status: 'paused',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tilt_deg: 10,
      azimuth_deg: 90,
      noct_c: 42,
      gamma_pct_per_c: -0.35,
      lat: 24.81,
      lon: -107.38,
      postal_code: '80000',
      colonia: 'Centro',
      commissioning_date: '2026-03-15',
      panel_count: 12,
      status: 'paused',
    });
  });

  it('rechaza un cliente de otra empresa o eliminado', async () => {
    const a = await session();
    const b = await session();
    const other = await api(a.auth).create(minimal(b.client.id));
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('INVALID_CLIENT');

    await ctx.owner.client.update({ where: { id: a.client.id }, data: { deletedAt: new Date() } });
    expect((await api(a.auth).create(minimal(a.client.id))).body.error.code).toBe('INVALID_CLIENT');
  });

  it('ignora company_id en el body', async () => {
    const a = await session();
    const b = await session();
    const res = await api(a.auth).create({ ...minimal(a.client.id), company_id: b.company.id });
    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.companyId).toBe(a.company.id);
  });

  it('valida los datos técnicos', async () => {
    const { client, auth } = await session();
    for (const invalid of [
      { ...minimal(client.id), capacity_kwp: 0 },
      { ...minimal(client.id), tilt_deg: 95 },
      { ...minimal(client.id), azimuth_deg: 361 },
      { ...minimal(client.id), gamma_pct_per_c: 0.4 },
      { ...minimal(client.id), inverter_brand: 'tesla' },
      { ...minimal(client.id), lat: 24.8 },
      { ...minimal(client.id), commissioning_date: '15/03/2026' },
      { ...minimal(client.id), postal_code: '800' },
      { ...minimal(client.id), client_id: 'x' },
    ]) {
      expect((await api(auth).create(invalid)).status, JSON.stringify(invalid)).toBe(400);
    }
  });
});

describe('inversor simulado', () => {
  it('guarda el perfil de simulación validado', async () => {
    const { client, auth } = await session();
    const res = await api(auth).create({
      ...minimal(client.id),
      inverter_brand: 'simulator',
      simulation_profile: simulationProfile,
    });
    expect(res.status).toBe(201);
    expect(res.body.simulation_profile).toEqual(simulationProfile);
  });

  it('rechaza un perfil inválido o con otra marca', async () => {
    const { client, auth } = await session();
    const bad = await api(auth).create({
      ...minimal(client.id),
      inverter_brand: 'simulator',
      simulation_profile: { ...simulationProfile, scenarios: [{ type: 'meteorito' }] },
    });
    expect(bad.status).toBe(400);
    const wrongBrand = await api(auth).create({
      ...minimal(client.id),
      simulation_profile: simulationProfile,
    });
    expect(wrongBrand.status).toBe(400);
    expect(wrongBrand.body.error.code).toBe('INVALID_SIMULATION_PROFILE');
  });

  it('al cambiar la marca a una real se descarta el perfil', async () => {
    const { client, auth } = await session();
    const created = await api(auth).create({
      ...minimal(client.id),
      inverter_brand: 'simulator',
      simulation_profile: simulationProfile,
    });
    const res = await api(auth).patch(created.body.id, { inverter_brand: 'huawei' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inverter_brand: 'huawei', simulation_profile: null });
  });

  it('no se permite si SIMULATOR_ENABLED=false', async () => {
    const prod = await createTestContext({ SIMULATOR_ENABLED: 'false' });
    try {
      const { client, auth } = await session();
      const res = await request(prod.app)
        .post('/api/plants')
        .set('Authorization', auth)
        .send({ ...minimal(client.id), inverter_brand: 'simulator' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SIMULATOR_DISABLED');
    } finally {
      await prod.close();
    }
  });
});

describe('GET /api/plants (lista)', () => {
  it('filtra, busca, ordena y nunca incluye plantas borradas ni de otra empresa', async () => {
    const a = await session();
    const b = await session();
    const otherClient = await ctx.owner.client.create({
      data: {
        companyId: a.company.id,
        name: 'Hotel Tres Ríos',
        address: 'Blvd 1',
        colonia: 'Tres Ríos',
        postalCode: '80020',
        lat: 24.81,
        lon: -107.4,
      },
    });
    const mk = (over: object) => api(a.auth).create({ ...minimal(a.client.id), ...over });
    const small = await mk({ name: 'Casa Chica', capacity_kwp: 3 });
    const big = await mk({
      name: 'Hotel Techo',
      capacity_kwp: 80,
      client_id: otherClient.id,
      inverter_brand: 'huawei',
    });
    const paused = await mk({ name: 'Bodega', capacity_kwp: 20, status: 'paused' });
    const gone = await mk({ name: 'Borrada' });
    await api(a.auth).remove(gone.body.id);
    await api(b.auth).create(minimal(b.client.id));

    const ids = async (query: string) =>
      (await api(a.auth).list(query)).body.data.map((p: { id: string }) => p.id);

    expect(await ids('?page_size=100')).toEqual([paused.body.id, small.body.id, big.body.id]);
    expect(await ids('?sort=-capacity_kwp')).toEqual([big.body.id, paused.body.id, small.body.id]);
    expect(await ids('?status=paused')).toEqual([paused.body.id]);
    expect(await ids('?brand=huawei')).toEqual([big.body.id]);
    expect(await ids('?postal_code=80020')).toEqual([big.body.id]);
    expect(await ids('?colonia=tres%20r%C3%ADos')).toEqual([big.body.id]);
    expect(await ids(`?client_id=${otherClient.id}`)).toEqual([big.body.id]);
    expect(await ids('?q=hotel')).toEqual([big.body.id]); // nombre de planta o cliente
    expect(await ids('?q=quintas')).toHaveLength(2); // por nombre del cliente
    expect((await api(a.auth).list('?sort=potencia')).status).toBe(400);
  });
});

describe('PATCH /api/plants/:id', () => {
  it('actualiza los campos enviados y reasigna a otro cliente de la empresa', async () => {
    const { company, client, auth } = await session();
    const created = await api(auth).create(minimal(client.id));
    const newClient = await ctx.owner.client.create({
      data: {
        companyId: company.id,
        name: 'Nuevo dueño',
        address: 'x',
        colonia: 'Centro',
        postalCode: '80000',
        lat: 24.8,
        lon: -107.39,
      },
    });
    const res = await api(auth).patch(created.body.id, {
      capacity_kwp: 7.2,
      status: 'paused',
      client_id: newClient.id,
      panel_model: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      capacity_kwp: 7.2,
      status: 'paused',
      client: { id: newClient.id },
      tilt_deg: 20,
    });
  });

  it('rechaza reasignar a un cliente de otra empresa y lat sin lon', async () => {
    const a = await session();
    const b = await session();
    const created = await api(a.auth).create(minimal(a.client.id));
    expect((await api(a.auth).patch(created.body.id, { client_id: b.client.id })).status).toBe(400);
    expect((await api(a.auth).patch(created.body.id, { lat: null })).status).toBe(400);
    expect((await api(a.auth).patch(created.body.id, { lat: null, lon: null })).status).toBe(200);
  });

  it('ignora company_id en el body', async () => {
    const a = await session();
    const b = await session();
    const created = await api(a.auth).create(minimal(a.client.id));
    await api(a.auth).patch(created.body.id, { name: 'Renombrada', company_id: b.company.id });
    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored).toMatchObject({ companyId: a.company.id, name: 'Renombrada' });
  });
});

describe('DELETE /api/plants/:id', () => {
  it('borra lógicamente, audita y luego responde 404', async () => {
    const { company, user, client, auth } = await session();
    const created = await api(auth).create(minimal(client.id));
    expect((await api(auth).remove(created.body.id)).status).toBe(204);

    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.deletedAt).not.toBeNull();
    const [audit] = await ctx.owner.auditLog.findMany({
      where: { entityId: created.body.id, action: 'plant.deleted' },
    });
    expect(audit).toMatchObject({
      companyId: company.id,
      userId: user.id,
      metadata: { name: 'Casa Familia Ruiz', client_id: client.id },
    });

    expect((await api(auth).get(created.body.id)).status).toBe(404);
    expect((await api(auth).patch(created.body.id, { name: 'x' })).status).toBe(404);
    expect((await api(auth).remove(created.body.id)).status).toBe(404);
  });
});

describe('aislamiento entre empresas', () => {
  it('una planta de otra empresa responde 404 en GET, PATCH y DELETE y no cambia', async () => {
    const a = await session();
    const b = await session();
    const ofB = await api(b.auth).create(minimal(b.client.id));
    expect((await api(a.auth).get(ofB.body.id)).status).toBe(404);
    expect((await api(a.auth).patch(ofB.body.id, { name: 'Hackeada' })).status).toBe(404);
    expect((await api(a.auth).remove(ofB.body.id)).status).toBe(404);
    const stored = await ctx.owner.solarPlant.findUniqueOrThrow({ where: { id: ofB.body.id } });
    expect(stored).toMatchObject({ name: 'Casa Familia Ruiz', deletedAt: null });
  });
});

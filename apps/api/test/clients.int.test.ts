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
});
afterAll(() => ctx.close());

const validClient = {
  name: 'Abarrotes La Esperanza',
  contact_name: 'María López',
  phone: '667 123 4567',
  email: 'Maria@Example.com',
  address: 'Av. Álvaro Obregón 100',
  colonia: 'Centro',
  postal_code: '80000',
  lat: 24.806,
  lon: -107.394,
  cfe_tariff: 'pdbt',
  avg_monthly_kwh: 850,
  avg_monthly_bill_mxn: 3200.5,
  report_email: 'reportes@example.com',
};

async function session(role: UserRole = 'operator') {
  const company = await createCompany(ctx.owner);
  const user = await createUser(ctx.owner, { companyId: company.id, role });
  return { company, user, auth: `Bearer ${await tokenFor(user, ctx.clock.current)}` };
}

const api = (auth: string) => ({
  list: (query = '') => request(ctx.app).get(`/api/clients${query}`).set('Authorization', auth),
  create: (body: object) =>
    request(ctx.app).post('/api/clients').set('Authorization', auth).send(body),
  get: (id: string) => request(ctx.app).get(`/api/clients/${id}`).set('Authorization', auth),
  patch: (id: string, body: object) =>
    request(ctx.app).patch(`/api/clients/${id}`).set('Authorization', auth).send(body),
  remove: (id: string) => request(ctx.app).delete(`/api/clients/${id}`).set('Authorization', auth),
});

async function addPlant(companyId: string, clientId: string, deletedAt: Date | null = null) {
  return ctx.owner.solarPlant.create({
    data: {
      companyId,
      clientId,
      name: 'Planta',
      capacityKwp: 5,
      tiltDeg: 20,
      azimuthDeg: 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
      deletedAt,
    },
  });
}

describe('permisos', () => {
  it('company_admin y operator gestionan clientes; technician y superadmin no', async () => {
    for (const role of ['company_admin', 'operator'] as const) {
      const { auth } = await session(role);
      expect((await api(auth).create(validClient)).status, role).toBe(201);
    }
    const { auth: techAuth } = await session('technician');
    expect((await api(techAuth).list()).status).toBe(403);
    expect((await api(techAuth).create(validClient)).status).toBe(403);

    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    const superAuth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
    expect((await api(superAuth).list()).status).toBe(403);
  });
});

describe('POST y GET /api/clients', () => {
  it('crea el cliente con valores por defecto y normaliza correo y tarifa', async () => {
    const { company, auth } = await session();
    const res = await api(auth).create(validClient);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Abarrotes La Esperanza',
      email: 'maria@example.com',
      cfe_tariff: 'PDBT',
      city: 'Culiacán',
      state: 'Sinaloa',
      lat: 24.806,
      lon: -107.394,
      avg_monthly_bill_mxn: 3200.5,
      tariff_mxn_per_kwh: null,
      plant_count: 0,
    });
    const stored = await ctx.owner.client.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.companyId).toBe(company.id);

    const got = await api(auth).get(res.body.id);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(res.body);
  });

  it('ignora company_id en el body', async () => {
    const a = await session();
    const b = await session();
    const res = await api(a.auth).create({ ...validClient, company_id: b.company.id });
    expect(res.status).toBe(201);
    const stored = await ctx.owner.client.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.companyId).toBe(a.company.id);
  });

  it('valida los campos', async () => {
    const { auth } = await session();
    for (const invalid of [
      { ...validClient, name: '' },
      { ...validClient, postal_code: '8000' },
      { ...validClient, postal_code: 'ABCDE' },
      { ...validClient, lat: 91 },
      { ...validClient, lon: -181 },
      { ...validClient, email: 'no-es-correo' },
      { ...validClient, phone: 'llámame' },
      { ...validClient, avg_monthly_kwh: -5 },
      { ...validClient, tariff_mxn_per_kwh: 0 },
      { ...validClient, cfe_tariff: 'tarifa 1F' },
      (({ address: _a, ...rest }) => rest)(validClient),
    ]) {
      const res = await api(auth).create(invalid);
      expect(res.status, JSON.stringify(invalid)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/clients (lista)', () => {
  it('lista solo clientes vigentes de la empresa, con búsqueda, filtros y paginación', async () => {
    const a = await session();
    const b = await session();
    const mk = (over: object) => api(a.auth).create({ ...validClient, ...over });
    const zapata = await mk({ name: 'Ferretería Zapata', contact_name: 'Juan Pérez' });
    await mk({ name: 'Taller Beltrán', postal_code: '80020', colonia: 'Las Quintas' });
    const borrado = await mk({ name: 'Cliente Borrado' });
    await api(a.auth).remove(borrado.body.id);
    await api(b.auth).create({ ...validClient, name: 'Cliente de B' });

    const all = await api(a.auth).list('?page_size=100');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Ferretería Zapata',
      'Taller Beltrán',
    ]);

    expect((await api(a.auth).list('?q=juan')).body.data[0].id).toBe(zapata.body.id);
    expect((await api(a.auth).list('?q=ferreter')).body.total).toBe(1);
    expect((await api(a.auth).list('?postal_code=80020')).body.data[0].name).toBe('Taller Beltrán');
    expect((await api(a.auth).list('?colonia=las%20quintas')).body.total).toBe(1);

    const page = await api(a.auth).list('?page=2&page_size=1');
    expect(page.body).toMatchObject({ page: 2, page_size: 1, total: 2 });
    expect(page.body.data[0].name).toBe('Taller Beltrán');
  });

  it('cuenta solo las plantas vigentes', async () => {
    const { company, auth } = await session();
    const created = await api(auth).create(validClient);
    await addPlant(company.id, created.body.id);
    await addPlant(company.id, created.body.id, new Date());
    expect((await api(auth).get(created.body.id)).body.plant_count).toBe(1);
  });
});

describe('PATCH /api/clients/:id', () => {
  it('actualiza solo los campos enviados y permite borrar opcionales con null', async () => {
    const { auth } = await session();
    const created = await api(auth).create(validClient);
    const res = await api(auth).patch(created.body.id, {
      phone: null,
      tariff_mxn_per_kwh: 3.1,
      colonia: 'Chapultepec',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      phone: null,
      tariff_mxn_per_kwh: 3.1,
      colonia: 'Chapultepec',
      name: validClient.name,
      email: 'maria@example.com',
    });
  });

  it('no permite borrar campos obligatorios ni un body vacío', async () => {
    const { auth } = await session();
    const created = await api(auth).create(validClient);
    expect((await api(auth).patch(created.body.id, { name: null })).status).toBe(400);
    expect((await api(auth).patch(created.body.id, {})).status).toBe(400);
  });

  it('ignora company_id en el body', async () => {
    const a = await session();
    const b = await session();
    const created = await api(a.auth).create(validClient);
    await api(a.auth).patch(created.body.id, { name: 'Nuevo', company_id: b.company.id });
    const stored = await ctx.owner.client.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored).toMatchObject({ companyId: a.company.id, name: 'Nuevo' });
  });
});

describe('DELETE /api/clients/:id (borrado lógico)', () => {
  it('marca deleted_at, conserva la fila y luego responde 404', async () => {
    const { auth } = await session();
    const created = await api(auth).create(validClient);
    expect((await api(auth).remove(created.body.id)).status).toBe(204);

    const stored = await ctx.owner.client.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect((await api(auth).get(created.body.id)).status).toBe(404);
    expect((await api(auth).patch(created.body.id, { name: 'X' })).status).toBe(404);
    expect((await api(auth).remove(created.body.id)).status).toBe(404);
  });

  it('no borra un cliente con plantas vigentes', async () => {
    const { company, auth } = await session();
    const created = await api(auth).create(validClient);
    await addPlant(company.id, created.body.id);
    const res = await api(auth).remove(created.body.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLIENT_HAS_PLANTS');
  });
});

describe('aislamiento entre empresas', () => {
  it('un cliente de otra empresa responde 404 en GET, PATCH y DELETE y no cambia', async () => {
    const a = await session();
    const b = await session();
    const ofB = await api(b.auth).create(validClient);

    expect((await api(a.auth).get(ofB.body.id)).status).toBe(404);
    expect((await api(a.auth).patch(ofB.body.id, { name: 'Hackeado' })).status).toBe(404);
    expect((await api(a.auth).remove(ofB.body.id)).status).toBe(404);

    const stored = await ctx.owner.client.findUniqueOrThrow({ where: { id: ofB.body.id } });
    expect(stored).toMatchObject({ name: validClient.name, deletedAt: null });
  });

  it('un id inválido responde 400', async () => {
    const { auth } = await session();
    expect((await api(auth).get('123')).status).toBe(400);
  });
});

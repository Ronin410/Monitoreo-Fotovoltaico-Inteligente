import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Tiempo de trabajo de los tickets (specs/PREGUNTAS.md #204): de "Iniciar" (pasa a En curso) a
// "Resolver", y el resumen de los últimos días por responsable.

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const HOUR = 3_600_000;

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
  const plant = await ctx.owner.solarPlant.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: 'Planta',
      capacityKwp: 5,
      tiltDeg: 20,
      azimuthDeg: 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
    },
  });
  const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
  const tech = await createUser(ctx.owner, { companyId: company.id, role: 'technician' });
  const auth = async (u: typeof admin) => `Bearer ${await tokenFor(u, ctx.clock.current)}`;
  const ticket = () =>
    ctx.owner.maintenanceTicket.create({
      data: {
        companyId: company.id,
        plantId: plant.id,
        type: 'inspection',
        title: 'Revisión',
        assignedToId: tech.id,
        createdAt: ctx.clock.current,
      },
    });
  return { company, admin, tech, auth, ticket };
}

const patch = async (id: string, auth: string, body: object) =>
  request(ctx.app).patch(`/api/tickets/${id}`).set('Authorization', auth).send(body);

describe('tiempo de trabajo de los tickets', () => {
  it('guarda el inicio la primera vez que pasa a En curso y el resumen lo cuenta', async () => {
    const f = await fleet();
    const t = await f.ticket();
    ctx.clock.advance(HOUR); // espera de 1 h
    const started = await patch(t.id, await f.auth(f.tech), { status: 'in_progress' });
    expect(started.status).toBe(200);
    const startedAt = started.body.started_at as string;
    expect(new Date(startedAt).getTime()).toBe(ctx.clock.current.getTime());

    ctx.clock.advance(HOUR / 2);
    // Repetir "En curso" no reinicia el reloj.
    const again = await patch(t.id, await f.auth(f.tech), { status: 'in_progress' });
    expect(again.body.started_at).toBe(startedAt);

    ctx.clock.advance(HOUR + HOUR / 2); // 2 h de trabajo en total
    const resolved = await patch(t.id, await f.auth(f.tech), {
      status: 'resolved',
      resolution_notes: 'Listo',
    });
    expect(resolved.body.status).toBe('resolved');

    // Un ticket resuelto sin iniciar: cuenta en el total pero no en el trabajo.
    const direct = await f.ticket();
    ctx.clock.advance(HOUR);
    await patch(direct.id, await f.auth(f.admin), { status: 'resolved' });

    const stats = await request(ctx.app)
      .get('/api/tickets/stats?days=30')
      .set('Authorization', await f.auth(f.admin));
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({
      days: 30,
      resolved: 2,
      in_progress: 0,
      work: { count: 1, avg_minutes: 120, median_minutes: 120 },
      wait: { count: 1, avg_minutes: 60 },
      total: { count: 2, avg_minutes: (180 + 60) / 2 },
    });
    expect(stats.body.by_assignee).toEqual([
      {
        id: f.tech.id,
        name: f.tech.name,
        resolved: 2,
        work: { count: 1, avg_minutes: 120, median_minutes: 120 },
      },
    ]);
  });

  it('el técnico no ve el resumen', async () => {
    const f = await fleet();
    const res = await request(ctx.app)
      .get('/api/tickets/stats')
      .set('Authorization', await f.auth(f.tech));
    expect(res.status).toBe(403);
  });
});

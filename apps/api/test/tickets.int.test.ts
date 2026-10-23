import type { UserRole } from '@pv/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createUser,
  tokenFor,
  type TestContext,
  createTestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

/** Empresa con un cliente, una planta y usuarios por rol. */
async function fleet() {
  const company = await createCompany(ctx.owner);
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: 'Abarrotes El Sol',
      contactName: 'Rosa Félix',
      phone: '667 123 4567',
      address: 'Av. Obregón 100',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8069,
      lon: -107.3938,
    },
  });
  const plant = await ctx.owner.solarPlant.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: 'Comercial Centro',
      capacityKwp: 30,
      tiltDeg: 10,
      azimuthDeg: 180,
      inverterBrand: 'goodwe',
      postalCode: '80000',
      colonia: 'Centro',
      lat: 24.8069,
      lon: -107.3938,
    },
  });
  const users = {} as Record<UserRole | 'technician2', { id: string; auth: string }>;
  for (const role of ['company_admin', 'operator', 'technician', 'technician2'] as const) {
    const user = await createUser(ctx.owner, {
      companyId: company.id,
      role: role === 'technician2' ? 'technician' : role,
    });
    users[role] = { id: user.id, auth: `Bearer ${await tokenFor(user, ctx.clock.current)}` };
  }
  return { company, client, plant, users };
}

type Fleet = Awaited<ReturnType<typeof fleet>>;

async function openAlert(
  f: Fleet,
  over: { type?: 'soiling' | 'sudden_drop' | 'offline'; severity?: 'warning' | 'critical' } = {},
) {
  return ctx.owner.alert.create({
    data: {
      companyId: f.company.id,
      plantId: f.plant.id,
      type: over.type ?? 'soiling',
      severity: over.severity ?? 'warning',
      detectedAt: new Date('2026-10-21T05:00:00Z'),
      evidence: {
        rule: over.type ?? 'soiling',
        trigger: {
          dates: ['2026-10-19', '2026-10-20', '2026-10-21'],
          deviation_pct: [13.1, 14, 15.2],
        },
      },
    },
  });
}

const http = (auth: string) => ({
  get: (path: string) => request(ctx.app).get(`/api${path}`).set('Authorization', auth),
  post: (path: string, body: object = {}) =>
    request(ctx.app).post(`/api${path}`).set('Authorization', auth).send(body),
  patch: (path: string, body: object) =>
    request(ctx.app).patch(`/api${path}`).set('Authorization', auth).send(body),
});

describe('alertas', () => {
  it('bandeja con filtros y detalle con evidencia', async () => {
    const f = await fleet();
    const soiling = await openAlert(f);
    await openAlert(f, { type: 'sudden_drop', severity: 'critical' });
    const op = http(f.users.operator.auth);

    const all = await op.get('/alerts?open=true');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.data[0]).toMatchObject({
      plant: { id: f.plant.id, name: 'Comercial Centro', client_name: 'Abarrotes El Sol' },
    });
    expect(all.body.data[0]).not.toHaveProperty('evidence');
    const critical = await op.get('/alerts?severity=critical');
    expect(critical.body.data.map((a: { type: string }) => a.type)).toEqual(['sudden_drop']);
    expect((await op.get('/alerts?postal_code=80060')).body.total).toBe(0);

    const detail = await op.get(`/alerts/${soiling.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      type: 'soiling',
      status: 'open',
      evidence: { rule: 'soiling', trigger: { deviation_pct: [13.1, 14, 15.2] } },
      ai_explanation: null,
    });
  });

  it('reconocer y descartar (con motivo obligatorio); una cerrada no cambia', async () => {
    const f = await fleet();
    const alert = await openAlert(f);
    const op = http(f.users.operator.auth);

    expect((await op.post(`/alerts/${alert.id}/acknowledge`)).body.status).toBe('acknowledged');
    expect((await op.post(`/alerts/${alert.id}/acknowledge`)).status).toBe(200);
    const noReason = await op.post(`/alerts/${alert.id}/dismiss`, {});
    expect(noReason.status).toBe(400);
    const dismissed = await op.post(`/alerts/${alert.id}/dismiss`, {
      reason: 'El cliente apagó el sistema por remodelación',
    });
    expect(dismissed.body).toMatchObject({
      status: 'dismissed',
      dismiss_reason: 'El cliente apagó el sistema por remodelación',
    });
    expect((await op.post(`/alerts/${alert.id}/acknowledge`)).status).toBe(409);
    expect((await op.post(`/alerts/${alert.id}/dismiss`, { reason: 'otra vez' })).status).toBe(409);
  });

  it('el técnico no ve la bandeja de alertas', async () => {
    const f = await fleet();
    const alert = await openAlert(f);
    const tech = http(f.users.technician.auth);
    expect((await tech.get('/alerts')).status).toBe(403);
    expect((await tech.get(`/alerts/${alert.id}`)).status).toBe(403);
    expect((await tech.post(`/alerts/${alert.id}/ticket`)).status).toBe(403);
  });

  it('crea el ticket prellenado desde la alerta y la liga', async () => {
    const f = await fleet();
    const alert = await openAlert(f);
    const op = http(f.users.operator.auth);

    const res = await op.post(`/alerts/${alert.id}/ticket`, {
      assigned_to: f.users.technician.id,
      scheduled_for: '2026-10-24',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'cleaning',
      status: 'scheduled',
      priority: 'normal',
      title: 'Lavado de paneles — Comercial Centro',
      description: 'Posible suciedad. Rinde 15.2 % por debajo de su normal.',
      scheduled_for: '2026-10-24',
      assigned_to: { id: f.users.technician.id },
      created_by: { id: f.users.operator.id },
      alert: { id: alert.id, type: 'soiling', status: 'acknowledged' },
      plant: {
        id: f.plant.id,
        lat: 24.8069,
        lon: -107.3938,
        client: { name: 'Abarrotes El Sol', phone: '667 123 4567', address: 'Av. Obregón 100' },
      },
    });
    const stored = await ctx.owner.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(stored).toMatchObject({ ticketId: res.body.id, status: 'acknowledged' });

    // Una alerta con ticket abierto no crea otro.
    const again = await op.post(`/alerts/${alert.id}/ticket`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TICKET_EXISTS');
  });

  it('caída brusca crítica → inspección de prioridad alta', async () => {
    const f = await fleet();
    const alert = await openAlert(f, { type: 'sudden_drop', severity: 'critical' });
    const res = await http(f.users.company_admin.auth).post(`/alerts/${alert.id}/ticket`);
    expect(res.body).toMatchObject({ type: 'inspection', priority: 'high', status: 'pending' });
  });
});

describe('tickets', () => {
  async function ticketFor(f: Fleet, assignee: string | null) {
    const res = await http(f.users.operator.auth).post('/tickets', {
      plant_id: f.plant.id,
      type: 'cleaning',
      title: 'Lavado mensual',
      assigned_to: assignee,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('el operador crea, lista con filtros y reasigna', async () => {
    const f = await fleet();
    const op = http(f.users.operator.auth);
    const t = await ticketFor(f, f.users.technician.id);
    expect((await op.get('/tickets?open=true')).body.total).toBe(1);
    expect((await op.get(`/tickets?assigned_to=${f.users.technician2.id}`)).body.total).toBe(0);

    const moved = await op.patch(`/tickets/${t.id}`, {
      assigned_to: f.users.technician2.id,
      priority: 'high',
    });
    expect(moved.body).toMatchObject({
      assigned_to: { id: f.users.technician2.id },
      priority: 'high',
    });
  });

  it('el responsable debe ser un usuario activo de la misma empresa', async () => {
    const f = await fleet();
    const other = await fleet();
    const op = http(f.users.operator.auth);
    const res = await op.post('/tickets', {
      plant_id: f.plant.id,
      type: 'repair',
      title: 'x',
      assigned_to: other.users.technician.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    const foreignPlant = await op.post('/tickets', {
      plant_id: other.plant.id,
      type: 'repair',
      title: 'x',
    });
    expect(foreignPlant.status).toBe(400);
  });

  it('el técnico solo ve y actualiza sus tickets, y solo estado, notas y limpieza', async () => {
    const f = await fleet();
    const mine = await ticketFor(f, f.users.technician.id);
    const theirs = await ticketFor(f, f.users.technician2.id);
    await ticketFor(f, null);
    const tech = http(f.users.technician.auth);

    const list = await tech.get('/tickets');
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([mine.id]);
    // Aunque pida los de otro técnico, solo recibe los suyos.
    expect((await tech.get(`/tickets?assigned_to=${f.users.technician2.id}`)).body.total).toBe(0);
    expect((await tech.get(`/tickets/${theirs.id}`)).status).toBe(404);
    expect((await tech.patch(`/tickets/${theirs.id}`, { status: 'in_progress' })).status).toBe(404);

    expect((await tech.patch(`/tickets/${mine.id}`, { status: 'in_progress' })).body.status).toBe(
      'in_progress',
    );
    expect(
      (await tech.patch(`/tickets/${mine.id}`, { assigned_to: f.users.technician.id })).status,
    ).toBe(403);
    expect((await tech.patch(`/tickets/${mine.id}`, { priority: 'high' })).status).toBe(403);
    expect((await tech.patch(`/tickets/${mine.id}`, { status: 'cancelled' })).status).toBe(403);
    expect(
      (await tech.post('/tickets', { plant_id: f.plant.id, type: 'other', title: 'x' })).status,
    ).toBe(403);
  });

  it('resolver con limpieza crea el evento cleaning, pero no resuelve la alerta', async () => {
    ctx.clock.current = new Date('2026-10-23T17:30:00Z');
    const f = await fleet();
    const alert = await openAlert(f);
    const op = http(f.users.operator.auth);
    const t = (await op.post(`/alerts/${alert.id}/ticket`, { assigned_to: f.users.technician.id }))
      .body as { id: string };
    const tech = http(f.users.technician.auth);

    const resolved = await tech.patch(`/tickets/${t.id}`, {
      status: 'resolved',
      cleaning_performed: true,
      resolution_notes: 'Se lavaron los 54 paneles; mucho polvo.',
    });
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      cleaning_performed: true,
      resolved_at: '2026-10-23T17:30:00.000Z',
    });
    const events = await ctx.owner.plantEvent.findMany({ where: { plantId: f.plant.id } });
    expect(events).toMatchObject([
      {
        type: 'cleaning',
        source: 'ticket',
        ticketId: t.id,
        occurredAt: new Date('2026-10-23T17:30:00Z'),
        notes: 'Se lavaron los 54 paneles; mucho polvo.',
      },
    ]);
    // La alerta sigue abierta hasta que los datos confirmen la mejora (specs/06 §5).
    expect((await ctx.owner.alert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe(
      'acknowledged',
    );
    // Cerrado: no se vuelve a cambiar.
    expect((await tech.patch(`/tickets/${t.id}`, { status: 'in_progress' })).status).toBe(409);
    // Con el ticket anterior cerrado, la alerta admite uno nuevo.
    expect((await op.post(`/alerts/${alert.id}/ticket`)).status).toBe(201);
  });

  it('resolver sin limpieza no crea eventos', async () => {
    const f = await fleet();
    const t = await ticketFor(f, f.users.technician.id);
    await http(f.users.technician.auth).patch(`/tickets/${t.id}`, { status: 'resolved' });
    expect(await ctx.owner.plantEvent.count({ where: { plantId: f.plant.id } })).toBe(0);
  });
});

describe('aislamiento entre empresas', () => {
  it('alertas, tickets y eventos de otra empresa responden 404', async () => {
    const a = await fleet();
    const b = await fleet();
    const alertB = await openAlert(b);
    const ticketB = (
      await http(b.users.operator.auth).post('/tickets', {
        plant_id: b.plant.id,
        type: 'other',
        title: 'B',
      })
    ).body as { id: string };
    const op = http(a.users.operator.auth);

    expect((await op.get(`/alerts/${alertB.id}`)).status).toBe(404);
    expect((await op.post(`/alerts/${alertB.id}/acknowledge`)).status).toBe(404);
    expect((await op.post(`/alerts/${alertB.id}/dismiss`, { reason: 'no es mía' })).status).toBe(
      404,
    );
    expect((await op.post(`/alerts/${alertB.id}/ticket`)).status).toBe(404);
    expect((await op.get(`/tickets/${ticketB.id}`)).status).toBe(404);
    expect((await op.patch(`/tickets/${ticketB.id}`, { title: 'mío' })).status).toBe(404);
    expect((await op.get('/alerts')).body.total).toBe(0);
    expect((await op.get('/tickets')).body.total).toBe(0);
    expect((await op.get(`/plants/${b.plant.id}/events`)).status).toBe(404);
    expect(
      (
        await op.post(`/plants/${b.plant.id}/events`, {
          type: 'cleaning',
          occurred_at: '2026-10-22T10:00:00Z',
        })
      ).status,
    ).toBe(404);
  });
});

describe('eventos de planta', () => {
  it('registra una limpieza manual y la lista; no acepta fechas futuras ni rain_cleaning', async () => {
    ctx.clock.current = new Date('2026-10-23T18:00:00Z');
    const f = await fleet();
    const op = http(f.users.operator.auth);
    const created = await op.post(`/plants/${f.plant.id}/events`, {
      type: 'cleaning',
      occurred_at: '2026-10-23T09:30:00-07:00',
      notes: 'Lavado por el cliente',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      type: 'cleaning',
      source: 'manual',
      occurred_at: '2026-10-23T16:30:00.000Z',
    });
    const list = await op.get(`/plants/${f.plant.id}/events`);
    expect(list.body).toMatchObject({ total: 1, data: [{ id: created.body.id }] });

    const future = await op.post(`/plants/${f.plant.id}/events`, {
      type: 'cleaning',
      occurred_at: '2026-10-24T09:00:00Z',
    });
    expect(future.status).toBe(400);
    const rain = await op.post(`/plants/${f.plant.id}/events`, {
      type: 'rain_cleaning',
      occurred_at: '2026-10-23T09:00:00Z',
    });
    expect(rain.status).toBe(400);
    expect((await http(f.users.technician.auth).get(`/plants/${f.plant.id}/events`)).status).toBe(
      403,
    );
  });
});

describe('correo de ticket asignado', () => {
  it('avisa al responsable al crear y al reasignar, una vez por responsable', async () => {
    const f = await fleet();
    const op = http(f.users.operator.auth);
    const sends = () =>
      ctx.jobs.jobs.filter(
        (j) =>
          j.name === 'notifications.send' &&
          (j.payload as { company_id: string }).company_id === f.company.id,
      );
    const notifications = () =>
      ctx.owner.notification.findMany({
        where: { companyId: f.company.id },
        orderBy: { createdAt: 'asc' },
      });

    const t = (
      await op.post('/tickets', {
        plant_id: f.plant.id,
        type: 'cleaning',
        title: 'Lavado mensual',
        assigned_to: f.users.technician.id,
        scheduled_for: '2026-10-24',
      })
    ).body as { id: string };
    const [first] = await notifications();
    const tech = await ctx.owner.user.findUniqueOrThrow({ where: { id: f.users.technician.id } });
    expect(first).toMatchObject({
      recipient: tech.email,
      template: 'ticket_assigned',
      status: 'queued',
      relatedType: 'ticket',
      relatedId: t.id,
      subject: 'Nuevo ticket asignado: Lavado mensual',
      payload: {
        ticket_id: t.id,
        plant_name: 'Comercial Centro',
        address: 'Av. Obregón 100',
        client_phone: '667 123 4567',
        scheduled_for: '2026-10-24',
        lat: 24.8069,
      },
    });
    expect(sends().map((j) => (j.payload as { notification_id: string }).notification_id)).toEqual([
      first!.id,
    ]);

    // Cambios que no son de responsable no avisan; reasignar sí, y volver al primero no repite.
    await op.patch(`/tickets/${t.id}`, { priority: 'high' });
    await op.patch(`/tickets/${t.id}`, { assigned_to: f.users.technician2.id });
    await op.patch(`/tickets/${t.id}`, { assigned_to: f.users.technician.id });
    expect(await notifications()).toHaveLength(2);
    expect(sends()).toHaveLength(2);

    // Sin responsable no hay correo; desde una alerta, sí.
    await op.post('/tickets', { plant_id: f.plant.id, type: 'other', title: 'Sin asignar' });
    const alert = await openAlert(f);
    await op.post(`/alerts/${alert.id}/ticket`, { assigned_to: f.users.technician2.id });
    expect(await notifications()).toHaveLength(3);
  });
});

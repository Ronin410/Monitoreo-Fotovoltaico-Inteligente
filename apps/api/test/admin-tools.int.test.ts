import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Herramientas del superadmin para una empresa: reenviar la invitación al primer administrador y
// pedir datos de ejemplo (specs/PREGUNTAS.md #202 y #203).

let ctx: TestContext;
let noSimulator: TestContext;
let superAuth: string;
beforeAll(async () => {
  ctx = await createTestContext();
  noSimulator = await createTestContext({ SIMULATOR_ENABLED: 'false' });
  const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
  superAuth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
});
afterAll(async () => {
  await ctx.close();
  await noSimulator.close();
});

const post = (c: TestContext, path: string, auth: string, body?: object) =>
  request(c.app).post(`/api${path}`).set('Authorization', auth).send(body);

describe('reenviar la invitación del primer administrador', () => {
  it('crea una invitación nueva de company_admin, la manda y la audita', async () => {
    const company = await createCompany(ctx.owner);
    const email = `Admin-${Date.now()}@Ejemplo.mx`;
    const res = await post(ctx, `/admin/companies/${company.id}/invitations`, superAuth, { email });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: email.toLowerCase(),
      role: 'company_admin',
      email_sent: true,
    });
    expect(ctx.email.lastTo(email.toLowerCase())?.text).toContain('/invitacion/');
    const invitation = await ctx.owner.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(invitation).toMatchObject({ companyId: company.id, role: 'company_admin' });
    const audit = await ctx.owner.auditLog.findMany({
      where: { companyId: company.id, action: 'user.invited' },
    });
    expect(audit[0]?.metadata).toMatchObject({ resent: true });
  });

  it('valida empresa, correo en uso y permisos', async () => {
    const company = await createCompany(ctx.owner);
    const user = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
    const inUse = await post(ctx, `/admin/companies/${company.id}/invitations`, superAuth, {
      email: user.email,
    });
    expect(inUse.body.error.code).toBe('EMAIL_IN_USE');
    const missing = await post(
      ctx,
      '/admin/companies/00000000-0000-4000-8000-000000000000/invitations',
      superAuth,
      { email: 'x@ejemplo.mx' },
    );
    expect(missing.status).toBe(404);
    const asAdmin = await post(
      ctx,
      `/admin/companies/${company.id}/invitations`,
      `Bearer ${await tokenFor(user, ctx.clock.current)}`,
      { email: 'x@ejemplo.mx' },
    );
    expect(asAdmin.status).toBe(403);
  });
});

describe('datos de ejemplo', () => {
  it('encola la carga para una empresa vacía y la audita', async () => {
    const company = await createCompany(ctx.owner);
    const res = await post(ctx, `/admin/companies/${company.id}/example-data`, superAuth);
    expect(res.status).toBe(202);
    expect(ctx.jobs.jobs.at(-1)).toEqual({
      name: 'demo.example_data',
      payload: { company_id: company.id },
    });
    expect(
      await ctx.owner.auditLog.count({
        where: { companyId: company.id, action: 'company.example_data_requested' },
      }),
    ).toBe(1);
  });

  it('no aplica a empresas con plantas ni sin el simulador habilitado', async () => {
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
    await ctx.owner.solarPlant.create({
      data: {
        companyId: company.id,
        clientId: client.id,
        name: 'P',
        capacityKwp: 5,
        tiltDeg: 20,
        azimuthDeg: 180,
        inverterBrand: 'simulator',
        postalCode: '80000',
        colonia: 'Centro',
      },
    });
    const full = await post(ctx, `/admin/companies/${company.id}/example-data`, superAuth);
    expect(full.body.error.code).toBe('COMPANY_NOT_EMPTY');

    const empty = await createCompany(ctx.owner);
    const off = await post(noSimulator, `/admin/companies/${empty.id}/example-data`, superAuth);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('EXAMPLE_DATA_DISABLED');
    expect(noSimulator.jobs.jobs).toHaveLength(0);
  });
});

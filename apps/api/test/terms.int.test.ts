import { LEGAL_VERSION } from '@pv/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import {
  createCompany,
  createTestContext,
  createUser,
  freshIp,
  TEST_ENV,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Aceptación de términos de uso y aviso de privacidad (docs/plan-lanzamiento.md 3.5): versión,
// fecha e IP, al aceptar la invitación o, para quien ya tenía cuenta, al entrar.

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

async function invitation() {
  const company = await createCompany(ctx.owner);
  const auth = new AuthService({
    env: TEST_ENV,
    serviceDb: ctx.serviceDb,
    email: ctx.email,
    now: ctx.clock.now,
  });
  const email = `nuevo-${Date.now()}@example.com`;
  const pending = auth.newInvitation({
    companyId: company.id,
    email,
    role: 'technician',
    invitedById: null,
  });
  await ctx.owner.invitation.create({ data: pending.data });
  await pending.send(company.name);
  const token = /invitacion\/(\S+)/.exec(ctx.email.lastTo(email)?.text ?? '')?.[1] ?? '';
  return { email, token };
}

describe('aceptación de términos', () => {
  it('la invitación exige aceptar y registra versión, fecha e IP', async () => {
    const { email, token } = await invitation();
    const without = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Nuevo', password: 'contraseña-nueva-12' });
    expect(without.status).toBe(400);
    expect(await ctx.owner.user.count({ where: { email } })).toBe(0);

    const ip = freshIp();
    const ok = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .set('X-Forwarded-For', ip)
      .send({ name: 'Nuevo', password: 'contraseña-nueva-12', accept_terms: true });
    expect(ok.status).toBe(200);
    const user = await ctx.owner.user.findUniqueOrThrow({ where: { email } });
    expect(user.termsVersion).toBe(LEGAL_VERSION);
    expect(user.termsAcceptedAt).not.toBeNull();
    const [audit] = await ctx.owner.auditLog.findMany({
      where: { userId: user.id, action: 'legal.accepted' },
    });
    expect(audit).toMatchObject({ ip, metadata: { version: LEGAL_VERSION } });

    const me = await request(ctx.app)
      .get('/api/me')
      .set('Authorization', `Bearer ${ok.body.access_token}`);
    expect(me.body.legal).toEqual({ version: LEGAL_VERSION, accepted: true });
  });

  it('quien ya tenía cuenta la acepta al entrar; una versión vieja se rechaza', async () => {
    const company = await createCompany(ctx.owner);
    const user = await createUser(ctx.owner, { companyId: company.id, role: 'operator' });
    const auth = `Bearer ${await tokenFor(user, ctx.clock.current)}`;
    const me = () => request(ctx.app).get('/api/me').set('Authorization', auth);
    expect((await me()).body.legal).toEqual({ version: LEGAL_VERSION, accepted: false });

    const old = await request(ctx.app)
      .post('/api/me/accept-terms')
      .set('Authorization', auth)
      .send({ version: '2000-01-01' });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('TERMS_OUTDATED');

    const accept = await request(ctx.app)
      .post('/api/me/accept-terms')
      .set('Authorization', auth)
      .send({ version: LEGAL_VERSION });
    expect(accept.status).toBe(204);
    expect((await me()).body.legal.accepted).toBe(true);
    expect(
      await ctx.owner.auditLog.count({ where: { userId: user.id, action: 'legal.accepted' } }),
    ).toBe(1);
  });

  it('el superadmin también', async () => {
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    const auth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
    const me = await request(ctx.app).get('/api/me').set('Authorization', auth);
    expect(me.body.legal.accepted).toBe(false);
    const res = await request(ctx.app)
      .post('/api/me/accept-terms')
      .set('Authorization', auth)
      .send({ version: LEGAL_VERSION });
    expect(res.status).toBe(204);
  });
});

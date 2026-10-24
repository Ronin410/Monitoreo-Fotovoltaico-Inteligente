import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../src/audit.js';
import {
  createCompany,
  createTestContext,
  createUser,
  PASSWORD,
  refreshCookie,
  tokenFor,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function auditFor(where: { entityId?: string; companyId?: string; action?: string; ip?: string }) {
  return ctx.owner.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
}

async function companyAdmin() {
  const company = await createCompany(ctx.owner);
  const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
  return { company, admin, auth: `Bearer ${await tokenFor(admin, ctx.clock.current)}` };
}

describe('catálogo de acciones', () => {
  it('cubre las acciones sensibles de specs/02', () => {
    for (const action of [
      'auth.login',
      'user.invited',
      'user.updated',
      'plant.credentials_updated',
      'company.settings_updated',
      'plant.deleted',
      'report.sent',
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
});

describe('login', () => {
  it('registra el login exitoso con empresa, usuario e IP', async () => {
    const { company, admin } = await companyAdmin();
    const ip = nextIp();
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: admin.email, password: PASSWORD });
    expect(res.status).toBe(200);

    const rows = await auditFor({ entityId: admin.id, action: 'auth.login' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: company.id,
      userId: admin.id,
      entityType: 'user',
      ip,
    });
  });

  it('registra los intentos fallidos con el motivo, sin guardar contraseña ni correo inexistente', async () => {
    const { company, admin } = await companyAdmin();
    const wrongIp = nextIp();
    await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', wrongIp)
      .send({ email: admin.email, password: 'contraseña-equivocada' });
    const [wrong] = await auditFor({ ip: wrongIp });
    expect(wrong).toMatchObject({
      action: 'auth.login_failed',
      companyId: company.id,
      userId: admin.id,
      metadata: { reason: 'invalid_password' },
    });

    const unknownIp = nextIp();
    const ghost = `fantasma-${uniq()}@example.com`;
    await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', unknownIp)
      .send({ email: ghost, password: 'contraseña-equivocada' });
    const [unknown] = await auditFor({ ip: unknownIp });
    expect(unknown).toMatchObject({
      action: 'auth.login_failed',
      companyId: null,
      userId: null,
      metadata: { reason: 'unknown_email' },
    });
    expect(JSON.stringify([wrong, unknown])).not.toContain('contraseña-equivocada');
    expect(JSON.stringify(unknown)).not.toContain(ghost);
  });

  it('registra el motivo cuando la empresa está suspendida', async () => {
    const company = await createCompany(ctx.owner, { status: 'suspended' });
    const user = await createUser(ctx.owner, { companyId: company.id });
    const ip = nextIp();
    await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: user.email, password: PASSWORD });
    const [row] = await auditFor({ ip });
    expect(row?.metadata).toEqual({ reason: 'company_suspended' });
  });
});

describe('usuarios y roles', () => {
  it('registra la invitación, su aceptación y el cambio de rol', async () => {
    const { company, admin, auth } = await companyAdmin();
    const email = `nuevo-${uniq()}@example.com`;
    const ip = nextIp();
    const invite = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', auth)
      .set('X-Forwarded-For', ip)
      .send({ email, role: 'operator' });
    expect(invite.status).toBe(201);
    const [invited] = await auditFor({ entityId: invite.body.id });
    expect(invited).toMatchObject({
      action: 'user.invited',
      companyId: company.id,
      userId: admin.id,
      entityType: 'invitation',
      metadata: { email, role: 'operator' },
      ip,
    });

    const token = /invitacion\/(\S+)/.exec(ctx.email.lastTo(email)?.text ?? '')?.[1];
    const accept = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Nuevo', password: 'contraseña-nuevo-1' });
    const newUserId: string = accept.body.user.id;
    const [accepted] = await auditFor({ entityId: newUserId, action: 'user.invitation_accepted' });
    expect(accepted).toMatchObject({
      companyId: company.id,
      userId: newUserId,
      metadata: { invitation_id: invite.body.id, role: 'operator' },
    });

    await request(ctx.app)
      .patch(`/api/company/users/${newUserId}`)
      .set('Authorization', auth)
      .send({ role: 'technician', status: 'disabled' });
    const [updated] = await auditFor({ entityId: newUserId, action: 'user.updated' });
    expect(updated).toMatchObject({
      companyId: company.id,
      userId: admin.id,
      metadata: {
        changes: {
          role: { from: 'operator', to: 'technician' },
          status: { from: 'active', to: 'disabled' },
        },
      },
    });
  });

  it('un cambio rechazado no deja registro', async () => {
    const { company, admin } = await companyAdmin();
    const disabledAdmin = await createUser(ctx.owner, {
      companyId: company.id,
      role: 'company_admin',
      status: 'disabled',
    });
    const res = await request(ctx.app)
      .patch(`/api/company/users/${admin.id}`)
      .set('Authorization', `Bearer ${await tokenFor(disabledAdmin, ctx.clock.current)}`)
      .send({ role: 'operator' });
    expect(res.status).toBe(401);
    expect(await auditFor({ entityId: admin.id, action: 'user.updated' })).toEqual([]);
  });

  it('registra el restablecimiento de contraseña', async () => {
    const { company, admin } = await companyAdmin();
    await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: admin.email });
    const token = /restablecer-contrasena\/(\S+)/.exec(
      ctx.email.lastTo(admin.email)?.text ?? '',
    )?.[1];
    const ip = nextIp();
    const res = await request(ctx.app)
      .post('/api/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({ token, password: 'contraseña-nueva-99' });
    expect(res.status).toBe(204);
    const [row] = await auditFor({ entityId: admin.id, action: 'auth.password_reset' });
    expect(row).toMatchObject({ companyId: company.id, userId: admin.id, ip });
  });
});

describe('empresas (superadmin)', () => {
  it('registra el alta de empresa con su invitación y los cambios de estado', async () => {
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    const auth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
    const tag = uniq();
    const created = await request(ctx.app)
      .post('/api/admin/companies')
      .set('Authorization', auth)
      .send({ name: `Auditada ${tag}`, admin_email: `dueno-${tag}@example.com` });
    const companyId: string = created.body.company.id;

    const rows = await auditFor({ companyId });
    expect(rows.map((r) => r.action)).toEqual(['company.created', 'user.invited']);
    expect(rows.every((r) => r.userId === superadmin.id)).toBe(true);

    await request(ctx.app)
      .patch(`/api/admin/companies/${companyId}`)
      .set('Authorization', auth)
      .send({ status: 'suspended' });
    const [updated] = await auditFor({ companyId, action: 'company.updated' });
    expect(updated?.metadata).toEqual({ changes: { status: { from: 'active', to: 'suspended' } } });
  });
});

describe('sin secretos en la auditoría', () => {
  it('ningún registro contiene contraseñas, tokens ni hashes', async () => {
    const { admin } = await companyAdmin();
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: admin.email, password: PASSWORD });
    const access: string = login.body.access_token;
    const refresh = refreshCookie(login.headers['set-cookie']) ?? '';

    const all = JSON.stringify(await ctx.owner.auditLog.findMany());
    for (const secret of [PASSWORD, access, refresh, admin.passwordHash ?? '', '$argon2id$']) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toMatch(/"(password|token|passwordHash|token_hash)"/i);
  });
});

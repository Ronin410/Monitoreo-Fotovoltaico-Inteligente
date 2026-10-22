import type { UserRole } from '@pv/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  freshIp,
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

async function companyWithUsers() {
  const company = await createCompany(ctx.owner);
  const make = (role: UserRole) => createUser(ctx.owner, { companyId: company.id, role });
  return {
    company,
    admin: await make('company_admin'),
    operator: await make('operator'),
    technician: await make('technician'),
  };
}

const bearer = async (user: { id: string; companyId: string | null; role: UserRole }) =>
  `Bearer ${await tokenFor(user, ctx.clock.current)}`;

describe('autorización por rol en /api/company (users:manage)', () => {
  it('solo company_admin gestiona usuarios; los demás reciben 403', async () => {
    const { admin, operator, technician } = await companyWithUsers();
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });

    for (const user of [operator, technician, superadmin]) {
      const auth = await bearer(user);
      const list = await request(ctx.app).get('/api/company/users').set('Authorization', auth);
      expect(list.status, user.role).toBe(403);
      expect(list.body.error.code).toBe('FORBIDDEN');

      const invite = await request(ctx.app)
        .post('/api/company/invitations')
        .set('Authorization', auth)
        .send({ email: 'x@example.com', role: 'operator' });
      expect(invite.status, user.role).toBe(403);

      const patch = await request(ctx.app)
        .patch(`/api/company/users/${admin.id}`)
        .set('Authorization', auth)
        .send({ status: 'disabled' });
      expect(patch.status, user.role).toBe(403);
    }

    const ok = await request(ctx.app)
      .get('/api/company/users')
      .set('Authorization', await bearer(admin));
    expect(ok.status).toBe(200);
  });

  it('sin sesión responde 401', async () => {
    expect((await request(ctx.app).get('/api/company/users')).status).toBe(401);
  });
});

describe('GET /api/company/users', () => {
  it('lista solo los usuarios de la empresa, paginados', async () => {
    const a = await companyWithUsers();
    await companyWithUsers(); // empresa B, no debe aparecer

    const res = await request(ctx.app)
      .get('/api/company/users?page=1&page_size=2')
      .set('Authorization', await bearer(a.admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 2, total: 3 });
    expect(res.body.data).toHaveLength(2);

    const all = await request(ctx.app)
      .get('/api/company/users?page_size=100')
      .set('Authorization', await bearer(a.admin));
    expect(all.body.data.map((u: { id: string }) => u.id).sort()).toEqual(
      [a.admin.id, a.operator.id, a.technician.id].sort(),
    );
    expect(JSON.stringify(all.body)).not.toContain('password');
  });

  it('valida la paginación (máximo 100)', async () => {
    const { admin } = await companyWithUsers();
    const res = await request(ctx.app)
      .get('/api/company/users?page_size=500')
      .set('Authorization', await bearer(admin));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/company/invitations', () => {
  it('invita con el rol indicado y envía el correo', async () => {
    const { company, admin } = await companyWithUsers();
    const email = `Nuevo-${Date.now()}@Example.com`;
    const res = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', await bearer(admin))
      .send({ email, role: 'technician' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: email.toLowerCase(), role: 'technician' });

    const stored = await ctx.owner.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ companyId: company.id, invitedById: admin.id });
    expect(ctx.email.lastTo(email.toLowerCase())?.text).toContain('/invitacion/');
  });

  it('no permite invitar como superadmin ni a un correo que ya es de la empresa', async () => {
    const { admin, operator } = await companyWithUsers();
    const auth = await bearer(admin);
    const asSuper = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', auth)
      .send({ email: 'root@example.com', role: 'superadmin' });
    expect(asSuper.status).toBe(400);

    const dup = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', auth)
      .send({ email: operator.email, role: 'operator' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USER_EXISTS');
  });

  it('ignora un company_id enviado en el body', async () => {
    const a = await companyWithUsers();
    const b = await companyWithUsers();
    const res = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', await bearer(a.admin))
      .send({ email: `x-${Date.now()}@example.com`, role: 'operator', company_id: b.company.id });
    expect(res.status).toBe(201);
    const stored = await ctx.owner.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.companyId).toBe(a.company.id);
  });
});

describe('PATCH /api/company/users/:id', () => {
  it('cambia el rol de un usuario de la empresa', async () => {
    const { admin, operator } = await companyWithUsers();
    const res = await request(ctx.app)
      .patch(`/api/company/users/${operator.id}`)
      .set('Authorization', await bearer(admin))
      .send({ role: 'technician' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: operator.id, role: 'technician', status: 'active' });
  });

  it('desactivar a un usuario cierra sus sesiones y bloquea su login', async () => {
    const { admin, operator } = await companyWithUsers();
    const session = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: operator.email, password: PASSWORD });
    const cookie = refreshCookie(session.headers['set-cookie']) ?? '';

    const res = await request(ctx.app)
      .patch(`/api/company/users/${operator.id}`)
      .set('Authorization', await bearer(admin))
      .send({ status: 'disabled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disabled');

    const refresh = await request(ctx.app)
      .post('/api/auth/refresh')
      .set('Cookie', `pv_refresh=${encodeURIComponent(cookie)}`);
    expect(refresh.status).toBe(401);
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: operator.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('un usuario de otra empresa responde 404 y no se modifica', async () => {
    const a = await companyWithUsers();
    const b = await companyWithUsers();
    const res = await request(ctx.app)
      .patch(`/api/company/users/${b.operator.id}`)
      .set('Authorization', await bearer(a.admin))
      .send({ status: 'disabled' });
    expect(res.status).toBe(404);
    const stored = await ctx.owner.user.findUniqueOrThrow({ where: { id: b.operator.id } });
    expect(stored.status).toBe('active');
  });

  it('ignora company_id en el body (no mueve al usuario de empresa)', async () => {
    const a = await companyWithUsers();
    const b = await companyWithUsers();
    const res = await request(ctx.app)
      .patch(`/api/company/users/${a.operator.id}`)
      .set('Authorization', await bearer(a.admin))
      .send({ role: 'technician', company_id: b.company.id });
    expect(res.status).toBe(200);
    const stored = await ctx.owner.user.findUniqueOrThrow({ where: { id: a.operator.id } });
    expect(stored.companyId).toBe(a.company.id);
  });

  it('un admin no puede cambiarse a sí mismo', async () => {
    const { admin } = await companyWithUsers();
    const res = await request(ctx.app)
      .patch(`/api/company/users/${admin.id}`)
      .set('Authorization', await bearer(admin))
      .send({ role: 'operator' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('la empresa conserva al menos un administrador activo', async () => {
    const { company, admin } = await companyWithUsers();
    // Otro admin, ya desactivado, intenta quitarle el rol al único admin activo.
    const disabledAdmin = await createUser(ctx.owner, {
      companyId: company.id,
      role: 'company_admin',
      status: 'disabled',
    });
    const res = await request(ctx.app)
      .patch(`/api/company/users/${admin.id}`)
      .set('Authorization', await bearer(disabledAdmin))
      .send({ role: 'operator' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');

    const second = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
    const ok = await request(ctx.app)
      .patch(`/api/company/users/${second.id}`)
      .set('Authorization', await bearer(admin))
      .send({ status: 'disabled' });
    expect(ok.status).toBe(200);
  });

  it('valida el cuerpo y el id', async () => {
    const { admin, operator } = await companyWithUsers();
    const auth = await bearer(admin);
    expect(
      (
        await request(ctx.app)
          .patch(`/api/company/users/${operator.id}`)
          .set('Authorization', auth)
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .patch(`/api/company/users/${operator.id}`)
          .set('Authorization', auth)
          .send({ role: 'superadmin' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .patch('/api/company/users/no-es-uuid')
          .set('Authorization', auth)
          .send({ role: 'operator' })
      ).status,
    ).toBe(400);
  });
});

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slugify } from '../src/admin/routes.js';
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
let superAuth: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
  superAuth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
});
afterAll(() => ctx.close());

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function createCompanyReq(body: Record<string, unknown>) {
  return request(ctx.app).post('/api/admin/companies').set('Authorization', superAuth).send(body);
}

function patchCompany(id: string, body: Record<string, unknown>) {
  return request(ctx.app)
    .patch(`/api/admin/companies/${id}`)
    .set('Authorization', superAuth)
    .send(body);
}

function login(email: string, password = PASSWORD) {
  return request(ctx.app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', freshIp())
    .send({ email, password });
}

describe('slugify', () => {
  it('quita acentos y signos', () => {
    expect(slugify('Solar Culiacán, S.A. de C.V.')).toBe('solar-culiacan-s-a-de-c-v');
    expect(slugify('  Energía   Ñuñoa  ')).toBe('energia-nunoa');
    expect(slugify('¡¡¡')).toBe('');
  });
});

describe('/api/admin solo para superadmin', () => {
  it('company_admin, operator y technician reciben 403', async () => {
    const company = await createCompany(ctx.owner);
    for (const role of ['company_admin', 'operator', 'technician'] as const) {
      const user = await createUser(ctx.owner, { companyId: company.id, role });
      const auth = `Bearer ${await tokenFor(user, ctx.clock.current)}`;
      const list = await request(ctx.app).get('/api/admin/companies').set('Authorization', auth);
      expect(list.status, role).toBe(403);
      const create = await request(ctx.app)
        .post('/api/admin/companies')
        .set('Authorization', auth)
        .send({ name: 'X', admin_email: 'x@example.com' });
      expect(create.status, role).toBe(403);
      const patch = await request(ctx.app)
        .patch(`/api/admin/companies/${company.id}`)
        .set('Authorization', auth)
        .send({ status: 'suspended' });
      expect(patch.status, role).toBe(403);
    }
    const stored = await ctx.owner.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored.status).toBe('active');
  });
});

describe('POST /api/admin/companies', () => {
  it('crea la empresa e invita a su primer company_admin, que puede entrar', async () => {
    const tag = uniq();
    const adminEmail = `admin-${tag}@example.com`;
    const res = await createCompanyReq({
      name: `Solar Culiacán ${tag}`,
      admin_email: adminEmail.toUpperCase(),
      brand_color: '#10B981',
    });
    expect(res.status).toBe(201);
    expect(res.body.company).toMatchObject({
      name: `Solar Culiacán ${tag}`,
      slug: `solar-culiacan-${tag}`,
      status: 'active',
      timezone: 'America/Mazatlan',
      brand_color: '#10B981',
      ai_monthly_token_budget: 2_000_000,
      plant_count: 0,
    });
    expect(res.body.invitation).toMatchObject({ email: adminEmail, role: 'company_admin' });

    const mail = ctx.email.lastTo(adminEmail);
    expect(mail?.subject).toContain(`Solar Culiacán ${tag}`);
    const token = /invitacion\/(\S+)/.exec(mail?.text ?? '')?.[1];

    const accept = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Dueña', password: 'contraseña-duena-1' });
    expect(accept.status).toBe(200);
    expect(accept.body.user).toMatchObject({
      role: 'company_admin',
      company_id: res.body.company.id,
    });

    const me = await request(ctx.app)
      .get('/api/me')
      .set('Authorization', `Bearer ${accept.body.access_token}`);
    expect(me.body.company).toMatchObject({ id: res.body.company.id, brand_color: '#10B981' });
  });

  it('rechaza un slug repetido o un correo que ya tiene cuenta', async () => {
    const tag = uniq();
    const first = await createCompanyReq({
      name: 'A',
      slug: `dup-${tag}`,
      admin_email: `a-${tag}@example.com`,
    });
    expect(first.status).toBe(201);

    const dupSlug = await createCompanyReq({
      name: 'B',
      slug: `dup-${tag}`,
      admin_email: `b-${tag}@example.com`,
    });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.error.code).toBe('SLUG_TAKEN');

    const company = await createCompany(ctx.owner);
    const existing = await createUser(ctx.owner, { companyId: company.id });
    const dupEmail = await createCompanyReq({ name: `C ${tag}`, admin_email: existing.email });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('no deja la empresa a medias si falla (sin correo enviado)', async () => {
    const tag = uniq();
    await createCompanyReq({ name: 'X', slug: `atom-${tag}`, admin_email: `x-${tag}@e.com` });
    const sentBefore = ctx.email.sent.length;
    const res = await createCompanyReq({
      name: 'Y',
      slug: `atom-${tag}`,
      admin_email: `y-${tag}@example.com`,
    });
    expect(res.status).toBe(409);
    expect(ctx.email.sent.length).toBe(sentBefore);
    expect(await ctx.owner.invitation.count({ where: { email: `y-${tag}@example.com` } })).toBe(0);
  });

  it('valida los datos de entrada', async () => {
    for (const body of [
      { admin_email: 'a@example.com' },
      { name: 'X', admin_email: 'no-es-correo' },
      { name: 'X', admin_email: 'a@example.com', brand_color: 'rojo' },
      { name: 'X', admin_email: 'a@example.com', timezone: 'Culiacan/Centro' },
      { name: 'X', admin_email: 'a@example.com', slug: 'Con Espacios' },
      { name: '¡¡¡', admin_email: 'a@example.com' },
    ]) {
      expect((await createCompanyReq(body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('GET /api/admin/companies', () => {
  it('lista empresas con conteo de plantas y uso de IA del mes, sin datos operativos', async () => {
    const company = await createCompany(ctx.owner);
    const client = await ctx.owner.client.create({
      data: {
        companyId: company.id,
        name: 'Cliente',
        phone: '6671234567',
        email: 'cliente@example.com',
        address: 'Calle 1',
        colonia: 'Centro',
        postalCode: '80000',
        lat: 24.8,
        lon: -107.39,
      },
    });
    const plant = (name: string, deletedAt: Date | null = null) =>
      ctx.owner.solarPlant.create({
        data: {
          companyId: company.id,
          clientId: client.id,
          name,
          capacityKwp: 5,
          tiltDeg: 20,
          azimuthDeg: 180,
          inverterBrand: 'simulator',
          postalCode: '80000',
          colonia: 'Centro',
          deletedAt,
        },
      });
    await plant('P1');
    await plant('P2');
    await plant('Borrada', new Date());
    await ctx.owner.aiUsageMonthly.createMany({
      data: [
        {
          companyId: company.id,
          period: '2026-10',
          feature: 'chat',
          inputTokens: 1000n,
          outputTokens: 200n,
        },
        {
          companyId: company.id,
          period: '2026-10',
          feature: 'alert_explanation',
          inputTokens: 300n,
          outputTokens: 50n,
        },
        {
          companyId: company.id,
          period: '2026-09',
          feature: 'chat',
          inputTokens: 9999n,
          outputTokens: 1n,
        },
      ],
    });

    const res = await request(ctx.app)
      .get('/api/admin/companies?page_size=100')
      .set('Authorization', superAuth);
    expect(res.status).toBe(200);
    const row = res.body.data.find((c: { id: string }) => c.id === company.id);
    expect(row).toMatchObject({ plant_count: 2, ai_tokens_this_month: 1550, status: 'active' });

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('cliente@example.com');
    expect(text).not.toContain('6671234567');
    expect(text).not.toContain('P1');
  });

  it('filtra por estado', async () => {
    const suspended = await createCompany(ctx.owner, { status: 'suspended' });
    const res = await request(ctx.app)
      .get('/api/admin/companies?status=suspended&page_size=100')
      .set('Authorization', superAuth);
    expect(res.body.data.every((c: { status: string }) => c.status === 'suspended')).toBe(true);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(suspended.id);
  });
});

describe('PATCH /api/admin/companies/:id', () => {
  it('suspender bloquea el login y cierra las sesiones; reactivar lo permite de nuevo', async () => {
    const company = await createCompany(ctx.owner);
    const user = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
    const session = await login(user.email);
    const cookie = refreshCookie(session.headers['set-cookie']) ?? '';

    const res = await patchCompany(company.id, { status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('suspended');

    expect((await login(user.email)).status).toBe(401);
    const refresh = await request(ctx.app)
      .post('/api/auth/refresh')
      .set('Cookie', `pv_refresh=${encodeURIComponent(cookie)}`);
    expect(refresh.status).toBe(401);
    const me = await request(ctx.app)
      .get('/api/me')
      .set('Authorization', `Bearer ${session.body.access_token}`);
    expect(me.status).toBe(401);

    expect((await patchCompany(company.id, { status: 'active' })).status).toBe(200);
    expect((await login(user.email)).status).toBe(200);
  });

  it('una empresa suspendida no permite aceptar invitaciones', async () => {
    const tag = uniq();
    const created = await createCompanyReq({ name: `Inv ${tag}`, admin_email: `inv-${tag}@e.com` });
    const token = /invitacion\/(\S+)/.exec(ctx.email.lastTo(`inv-${tag}@e.com`)?.text ?? '')?.[1];
    await patchCompany(created.body.company.id, { status: 'suspended' });
    expect((await request(ctx.app).get(`/api/auth/invitations/${token}`)).status).toBe(404);
  });

  it('cambia el plan y el presupuesto de IA', async () => {
    const company = await createCompany(ctx.owner);
    const res = await patchCompany(company.id, { plan: 'pro', ai_monthly_token_budget: 5_000_000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'pro', ai_monthly_token_budget: 5_000_000 });
  });

  it('valida el cuerpo y responde 404 a una empresa inexistente', async () => {
    const company = await createCompany(ctx.owner);
    expect((await patchCompany(company.id, {})).status).toBe(400);
    expect((await patchCompany(company.id, { status: 'deleted' })).status).toBe(400);
    expect((await patchCompany(company.id, { ai_monthly_token_budget: -1 })).status).toBe(400);
    expect((await patchCompany('00000000-0000-4000-8000-000000000000', { plan: 'x' })).status).toBe(
      404,
    );
  });
});

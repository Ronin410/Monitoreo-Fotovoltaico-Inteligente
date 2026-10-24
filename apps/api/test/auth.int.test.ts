import request from 'supertest';
import { withTenant } from '@pv/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/service.js';
import {
  createCompany,
  createTestContext,
  createUser,
  freshIp,
  PASSWORD,
  refreshCookie,
  TEST_ENV,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function login(email: string, password = PASSWORD, ip = freshIp()) {
  return request(ctx.app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password });
}

function refresh(token: string | undefined) {
  const req = request(ctx.app).post('/api/auth/refresh');
  return token ? req.set('Cookie', `pv_refresh=${encodeURIComponent(token)}`) : req;
}

function me(accessToken: string) {
  return request(ctx.app).get('/api/me').set('Authorization', `Bearer ${accessToken}`);
}

async function activeUser(role: 'company_admin' | 'operator' | 'technician' = 'operator') {
  const company = await createCompany(ctx.owner);
  const user = await createUser(ctx.owner, { companyId: company.id, role });
  return { company, user };
}

describe('POST /api/auth/login', () => {
  it('devuelve access token, cookie de refresh segura y el usuario', async () => {
    const { company, user } = await activeUser();
    const res = await login(user.email.toUpperCase());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: user.id, email: user.email, role: 'operator', company_id: company.id },
    });
    expect(typeof res.body.access_token).toBe('string');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('pv_refresh='),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const stored = await ctx.owner.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lastLoginAt).toEqual(ctx.clock.current);
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('responde igual para contraseña incorrecta, correo inexistente, usuario desactivado o empresa suspendida', async () => {
    const { user } = await activeUser();
    const disabled = await createUser(ctx.owner, {
      companyId: (await createCompany(ctx.owner)).id,
      status: 'disabled',
    });
    const suspendedCompany = await createCompany(ctx.owner, { status: 'suspended' });
    const inSuspended = await createUser(ctx.owner, { companyId: suspendedCompany.id });

    const expected = {
      error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' },
    };
    for (const res of [
      await login(user.email, 'otra-contraseña-123'),
      await login('nadie@example.com'),
      await login(disabled.email),
      await login(inSuspended.email),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expected);
      expect(refreshCookie(res.headers['set-cookie'])).toBeUndefined();
    }
  });

  it('limita a 5 intentos por minuto por correo', async () => {
    const { user } = await activeUser();
    for (let i = 0; i < 5; i++) {
      expect((await login(user.email, 'incorrecta-123')).status).toBe(401);
    }
    const blocked = await login(user.email); // contraseña correcta, desde otra IP
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    ctx.clock.advance(MINUTE + 1000);
    expect((await login(user.email)).status).toBe(200);
  });

  it('limita a 5 intentos por minuto por IP', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < 5; i++) {
      expect((await login(`otro-${i}@example.com`, PASSWORD, ip)).status).toBe(401);
    }
    const { user } = await activeUser();
    expect((await login(user.email, PASSWORD, ip)).status).toBe(429);
    expect((await login(user.email, PASSWORD, freshIp())).status).toBe(200);
  });

  it('valida el cuerpo de la petición', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'no-es-correo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('access token y GET /api/me', () => {
  it('devuelve usuario y empresa con su marca', async () => {
    const { company, user } = await activeUser('company_admin');
    const { body } = await login(user.email);
    const res = await me(body.access_token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: user.id, email: user.email, name: user.name, role: 'company_admin' },
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        logo_url: null,
        brand_color: '#F59E0B',
        timezone: 'America/Mazatlan',
      },
      // SIMULATOR_ENABLED=true en el ambiente de pruebas.
      features: { simulator: true },
    });
  });

  it('el superadmin no pertenece a ninguna empresa', async () => {
    const admin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    const { body } = await login(admin.email);
    expect(body.user.company_id).toBeNull();
    const res = await me(body.access_token);
    expect(res.status).toBe(200);
    expect(res.body.company).toBeNull();
    expect(res.body.user.role).toBe('superadmin');
  });

  it('rechaza falta de token, token alterado, firmado con otro secreto o expirado', async () => {
    const { user } = await activeUser();
    const { body } = await login(user.email);
    const token: string = body.access_token;

    expect((await request(ctx.app).get('/api/me')).status).toBe(401);
    // Cambia un carácter del medio de la firma: siempre altera bytes reales (el último carácter
    // base64url lleva bits de relleno y cambiarlo puede no alterar la firma).
    const [h, p, sig = ''] = token.split('.');
    const i = Math.floor(sig.length / 2);
    const tampered = `${h}.${p}.${sig.slice(0, i)}${sig[i] === 'A' ? 'B' : 'A'}${sig.slice(i + 1)}`;
    expect((await me(tampered)).status).toBe(401);

    const [header, payload] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
        role: 'superadmin',
      }),
    ).toString('base64url');
    expect((await me(`${header}.${forgedPayload}.firma`)).status).toBe(401);

    ctx.clock.advance(15 * MINUTE + 1000);
    const expired = await me(token);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('un usuario desactivado deja de obtener /me aunque su token no haya expirado', async () => {
    const { user } = await activeUser();
    const { body } = await login(user.email);
    await ctx.owner.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    expect((await me(body.access_token)).status).toBe(401);
  });

  it('cada petición revisa usuario, empresa y rol vigentes (PREGUNTAS #23)', async () => {
    const { company, user } = await activeUser('company_admin');
    const token = (await login(user.email)).body.access_token as string;
    const users = () =>
      request(ctx.app).get('/api/company/users').set('Authorization', `Bearer ${token}`);
    expect((await users()).status).toBe(200);

    // Bajar de rol aplica en la siguiente petición, sin esperar a que venza el token.
    await ctx.owner.user.update({ where: { id: user.id }, data: { role: 'operator' } });
    expect((await users()).status).toBe(403);
    await ctx.owner.user.update({ where: { id: user.id }, data: { role: 'company_admin' } });
    expect((await users()).status).toBe(200);

    // Suspender la empresa corta el acceso de inmediato.
    await ctx.owner.company.update({ where: { id: company.id }, data: { status: 'suspended' } });
    const suspended = await users();
    expect(suspended.status).toBe(401);
    expect(suspended.body.error.code).toBe('UNAUTHENTICATED');
    await ctx.owner.company.update({ where: { id: company.id }, data: { status: 'active' } });
    expect((await users()).status).toBe(200);

    // Un usuario borrado tampoco.
    await ctx.owner.refreshToken.deleteMany({ where: { userId: user.id } });
    await ctx.owner.auditLog.updateMany({ where: { userId: user.id }, data: { userId: null } });
    await ctx.owner.user.delete({ where: { id: user.id } });
    expect((await users()).status).toBe(401);
  });
});

describe('POST /api/auth/refresh y /logout', () => {
  it('rota el refresh token y guarda solo su hash', async () => {
    const { user } = await activeUser();
    const first = refreshCookie((await login(user.email)).headers['set-cookie']);

    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe('string');
    const second = refreshCookie(res.headers['set-cookie']);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    const rows = await ctx.owner.refreshToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tokenHash)).not.toContain(first);
    expect(rows.map((r) => r.tokenHash)).not.toContain(second);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[0]?.replacedById).toBe(rows[1]?.id);
  });

  it('reusar un refresh token ya rotado revoca todas las sesiones', async () => {
    const { user } = await activeUser();
    const first = refreshCookie((await login(user.email)).headers['set-cookie']);
    const second = refreshCookie((await refresh(first)).headers['set-cookie']);

    const reuse = await refresh(first);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_SESSION');
    expect((await refresh(second)).status).toBe(401);
  });

  it('rechaza un refresh token expirado, inexistente o ausente', async () => {
    const { user } = await activeUser();
    const token = refreshCookie((await login(user.email)).headers['set-cookie']);
    expect((await refresh(undefined)).status).toBe(401);
    expect((await refresh('token-inventado')).status).toBe(401);

    ctx.clock.advance(30 * DAY + 1000);
    const res = await refresh(token);
    expect(res.status).toBe(401);
    expect(refreshCookie(res.headers['set-cookie'])).toBeUndefined();
  });

  it('no renueva la sesión si la empresa se suspendió', async () => {
    const { company, user } = await activeUser();
    const token = refreshCookie((await login(user.email)).headers['set-cookie']);
    await ctx.owner.company.update({ where: { id: company.id }, data: { status: 'suspended' } });
    expect((await refresh(token)).status).toBe(401);
  });

  it('logout revoca el refresh token y borra la cookie', async () => {
    const { user } = await activeUser();
    const token = refreshCookie((await login(user.email)).headers['set-cookie']);
    const res = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Cookie', `pv_refresh=${encodeURIComponent(token ?? '')}`);
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/pv_refresh=;/);
    expect((await refresh(token)).status).toBe(401);
  });
});

describe('recuperación de contraseña', () => {
  function forgot(email: string) {
    return request(ctx.app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', freshIp())
      .send({ email });
  }
  const tokenFromEmail = (text: string) => /restablecer-contrasena\/(\S+)/.exec(text)?.[1];

  it('envía un enlace de un solo uso, cambia la contraseña y cierra las sesiones', async () => {
    const { user } = await activeUser();
    const oldSession = refreshCookie((await login(user.email)).headers['set-cookie']);

    const res = await forgot(user.email);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const mail = ctx.email.lastTo(user.email);
    expect(mail?.text).toContain(`${TEST_ENV.APP_URL}/restablecer-contrasena/`);
    const token = tokenFromEmail(mail?.text ?? '');

    const newPassword = 'nueva-contraseña-456';
    const reset = await request(ctx.app)
      .post('/api/auth/reset-password')
      .send({ token, password: newPassword });
    expect(reset.status).toBe(204);

    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, newPassword)).status).toBe(200);
    expect((await refresh(oldSession)).status).toBe(401);

    const again = await request(ctx.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'otra-contraseña-789' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('responde 200 sin enviar nada si el correo no existe', async () => {
    const before = ctx.email.sent.length;
    const res = await forgot('desconocido@example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(ctx.email.sent.length).toBe(before);
  });

  it('el enlace expira en 1 hora', async () => {
    const { user } = await activeUser();
    await forgot(user.email);
    const token = tokenFromEmail(ctx.email.lastTo(user.email)?.text ?? '');
    ctx.clock.advance(61 * MINUTE);
    const res = await request(ctx.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'nueva-contraseña-456' });
    expect(res.status).toBe(400);
  });

  it('exige una contraseña de al menos 10 caracteres', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/reset-password')
      .send({ token: 'x', password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('invitaciones', () => {
  const tokenFromEmail = (text: string) => /invitacion\/(\S+)/.exec(text)?.[1];

  async function invite(role: 'company_admin' | 'operator' | 'technician' = 'technician') {
    const { company, user: admin } = await activeUser('company_admin');
    const email = `invitado-${Date.now()}-${Math.random()}@example.com`;
    const auth = new AuthService({
      env: TEST_ENV,
      serviceDb: ctx.serviceDb,
      email: ctx.email,
      now: ctx.clock.now,
    });
    const pending = await withTenant(ctx.db, company.id, (tx) =>
      auth.createInvitation(tx, { companyId: company.id, email, role, invitedById: admin.id }),
    );
    await pending.send();
    const token = tokenFromEmail(ctx.email.lastTo(email)?.text ?? '');
    return { company, email, token };
  }

  it('crea la invitación, la valida y al aceptarla crea el usuario e inicia sesión', async () => {
    const { company, email, token } = await invite('technician');

    const info = await request(ctx.app).get(`/api/auth/invitations/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({ email, role: 'technician', company_name: company.name });

    const accept = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Técnico Nuevo', password: 'contraseña-tecnico-1' });
    expect(accept.status).toBe(200);
    expect(accept.body.user).toMatchObject({ email, role: 'technician', company_id: company.id });
    expect(refreshCookie(accept.headers['set-cookie'])).toBeDefined();

    const user = await ctx.owner.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ status: 'active', name: 'Técnico Nuevo', companyId: company.id });

    const reuse = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Otra vez', password: 'contraseña-tecnico-2' });
    expect(reuse.status).toBe(404);
    expect((await request(ctx.app).get(`/api/auth/invitations/${token}`)).status).toBe(404);
  });

  it('la invitación expira a los 7 días', async () => {
    const { token } = await invite();
    ctx.clock.advance(7 * DAY + 1000);
    expect((await request(ctx.app).get(`/api/auth/invitations/${token}`)).status).toBe(404);
  });

  it('no permite aceptar si el correo ya tiene cuenta', async () => {
    const { email, token } = await invite();
    const company = await createCompany(ctx.owner);
    await ctx.owner.user.create({
      data: { companyId: company.id, email, name: 'Ya existe', role: 'operator' },
    });
    const res = await request(ctx.app)
      .post(`/api/auth/invitations/${token}/accept`)
      .send({ name: 'Nuevo', password: 'contraseña-nueva-12' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('un token inventado responde 404', async () => {
    expect((await request(ctx.app).get('/api/auth/invitations/inventado')).status).toBe(404);
  });
});

describe('secretos fuera de los logs', () => {
  it('no registra tokens, cookies ni contraseñas', async () => {
    const { user } = await activeUser();
    const res = await login(user.email);
    const token = res.body.access_token as string;
    const cookie = refreshCookie(res.headers['set-cookie']) ?? '';
    await me(token);
    await refresh(cookie);

    const logs = ctx.logLines.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(cookie);
    expect(logs).not.toContain(PASSWORD);
  });
});

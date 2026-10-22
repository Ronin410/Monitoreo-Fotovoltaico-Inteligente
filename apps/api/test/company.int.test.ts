import { DEFAULT_SETTINGS } from '@pv/core';
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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('datos-de-imagen'),
]);

async function companyWith(roles: UserRole[] = ['company_admin']) {
  const company = await createCompany(ctx.owner);
  const users = await Promise.all(
    roles.map(async (role) => {
      const user = await createUser(ctx.owner, { companyId: company.id, role });
      return { user, auth: `Bearer ${await tokenFor(user, ctx.clock.current)}` };
    }),
  );
  const [admin] = users;
  if (!admin) throw new Error('Se necesita al menos un usuario');
  return { company, users, admin };
}

const getCompany = (auth: string) =>
  request(ctx.app).get('/api/company').set('Authorization', auth);
const patchCompany = (auth: string, body: object) =>
  request(ctx.app).patch('/api/company').set('Authorization', auth).send(body);
const uploadLogo = (auth: string, body: Buffer, type: string) =>
  request(ctx.app)
    .post('/api/company/logo')
    .set('Authorization', auth)
    .set('Content-Type', type)
    .send(body);

describe('GET /api/company', () => {
  it('todos los roles de la empresa la ven, con settings completos', async () => {
    const { company, users } = await companyWith(['company_admin', 'operator', 'technician']);
    for (const { auth } of users) {
      const res = await getCompany(auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: company.id,
        name: company.name,
        brand_color: '#F59E0B',
        timezone: 'America/Mazatlan',
        logo_url: null,
      });
      expect(res.body.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('el superadmin no tiene empresa: 403', async () => {
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    expect(
      (await getCompany(`Bearer ${await tokenFor(superadmin, ctx.clock.current)}`)).status,
    ).toBe(403);
  });
});

describe('PATCH /api/company', () => {
  it('solo company_admin puede configurar', async () => {
    const { users } = await companyWith(['operator', 'technician']);
    for (const { auth } of users) {
      expect((await patchCompany(auth, { name: 'Otra' })).status).toBe(403);
    }
  });

  it('cambia marca y umbrales; guarda solo lo personalizado y audita los cambios', async () => {
    const { company, admin } = await companyWith();
    const res = await patchCompany(admin.auth, {
      name: 'Solar Norte',
      brand_color: '#2563EB',
      settings: {
        thresholds: { soiling_deviation_pct: 15, offline_hours: 6 },
        notifications: { alert_emails: ['Alertas@Example.com'] },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Solar Norte', brand_color: '#2563EB' });
    expect(res.body.settings.thresholds).toEqual({
      ...DEFAULT_SETTINGS.thresholds,
      soiling_deviation_pct: 15,
      offline_hours: 6,
    });
    expect(res.body.settings.notifications.alert_emails).toEqual(['alertas@example.com']);

    const stored = await ctx.owner.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored.settings).toEqual({
      thresholds: { soiling_deviation_pct: 15, offline_hours: 6 },
      notifications: { alert_emails: ['alertas@example.com'] },
    });

    const [audit] = await ctx.owner.auditLog.findMany({
      where: { companyId: company.id, action: 'company.settings_updated' },
    });
    expect(audit).toMatchObject({
      userId: admin.user.id,
      metadata: {
        changes: {
          name: { from: company.name, to: 'Solar Norte' },
          brand_color: { from: '#F59E0B', to: '#2563EB' },
          'thresholds.soiling_deviation_pct': { from: 12, to: 15 },
          'thresholds.offline_hours': { from: 4, to: 6 },
          'notifications.alert_emails': { from: [], to: ['alertas@example.com'] },
        },
      },
    });
  });

  it('null restablece una sección a los valores por defecto', async () => {
    const { admin } = await companyWith();
    const auth = admin.auth;
    await patchCompany(auth, {
      settings: { thresholds: { offline_hours: 8 }, defaults: { tilt_deg: 10 } },
    });
    const res = await patchCompany(auth, { settings: { thresholds: null } });
    expect(res.body.settings.thresholds).toEqual(DEFAULT_SETTINGS.thresholds);
    expect(res.body.settings.defaults.tilt_deg).toBe(10);
  });

  it('los valores por defecto técnicos se usan al crear plantas', async () => {
    const { company, admin } = await companyWith();
    const auth = admin.auth;
    await patchCompany(auth, { settings: { defaults: { tilt_deg: 12, noct_c: 44 } } });
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
    const plant = await request(ctx.app)
      .post('/api/plants')
      .set('Authorization', auth)
      .send({ client_id: client.id, name: 'P', capacity_kwp: 5, inverter_brand: 'goodwe' });
    expect(plant.body).toMatchObject({ tilt_deg: 12, noct_c: 44, azimuth_deg: 180 });
  });

  it('rechaza valores fuera de rango, campos desconocidos y campos que no son suyos', async () => {
    const { company, admin } = await companyWith();
    const auth = admin.auth;
    for (const body of [
      {},
      { settings: { thresholds: { soiling_deviation_pct: 80 } } },
      { settings: { thresholds: { offline_hrs: 5 } } },
      { settings: { defaults: { gamma_pct_per_c: 0.4 } } },
      { settings: { notifications: { alert_emails: ['no-es-correo'] } } },
      { brand_color: 'azul' },
      { timezone: 'Culiacan/Centro' },
      { slug: 'otro' },
      { plan: 'enterprise' },
      { status: 'active' },
      { ai_monthly_token_budget: 999_999_999 },
      { company_id: '00000000-0000-4000-8000-000000000000', name: 'X' },
    ]) {
      const res = await patchCompany(auth, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const res = await patchCompany(auth, {
      settings: { thresholds: { soiling_deviation_pct: 80 } },
    });
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'settings.thresholds.soiling_deviation_pct' }),
      ]),
    );
    const stored = await ctx.owner.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stored).toMatchObject({ name: company.name, plan: company.plan, settings: {} });
  });

  it('solo cambia la empresa de la sesión', async () => {
    const a = await companyWith();
    const b = await companyWith();
    await patchCompany(a.admin.auth, { name: 'Cambiada' });
    const other = await ctx.owner.company.findUniqueOrThrow({ where: { id: b.company.id } });
    expect(other.name).toBe(b.company.name);
  });
});

describe('POST /api/company/logo', () => {
  it('sube un PNG, lo sirve públicamente y aparece en /me', async () => {
    const { company, admin } = await companyWith();
    const auth = admin.auth;
    const res = await uploadLogo(auth, PNG, 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.logo_url).toMatch(
      new RegExp(`^http://localhost:4000/api/public/logos/${company.id}/[0-9a-f-]{36}\\.png$`),
    );

    const path = new URL(res.body.logo_url).pathname;
    const served = await request(ctx.app).get(path);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(served.body).equals(PNG)).toBe(true);

    const me = await request(ctx.app).get('/api/me').set('Authorization', auth);
    expect(me.body.company.logo_url).toBe(res.body.logo_url);
  });

  it('reemplazar borra el logo anterior', async () => {
    const { admin } = await companyWith();
    const auth = admin.auth;
    const first = await uploadLogo(auth, PNG, 'image/png');
    const second = await uploadLogo(
      auth,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
      'image/svg+xml',
    );
    expect(second.status).toBe(201);
    expect((await request(ctx.app).get(new URL(first.body.logo_url).pathname)).status).toBe(404);
    expect((await request(ctx.app).get(new URL(second.body.logo_url).pathname)).status).toBe(200);
  });

  it('sanea el SVG antes de guardarlo', async () => {
    const { admin } = await companyWith();
    const res = await uploadLogo(
      admin.auth,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="4"/></svg>',
      ),
      'image/svg+xml',
    );
    expect(res.status).toBe(201);
    const served = await request(ctx.app)
      .get(new URL(res.body.logo_url).pathname)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString()));
        r.on('end', () => cb(null, data));
      });
    expect(served.headers['content-type']).toContain('image/svg+xml');
    expect(served.body).toContain('<circle');
    expect(served.body).not.toContain('script');
    expect(served.body).not.toContain('onload');
  });

  it('valida tipo real, formato y tamaño', async () => {
    const { admin } = await companyWith();
    const auth = admin.auth;
    const fakePng = await uploadLogo(
      auth,
      Buffer.from('<html><script>1</script></html>'),
      'image/png',
    );
    expect(fakePng.status).toBe(400);
    expect(fakePng.body.error.code).toBe('INVALID_IMAGE');
    const mismatch = await uploadLogo(auth, PNG, 'image/jpeg');
    expect(mismatch.status).toBe(400);
    expect((await uploadLogo(auth, Buffer.from('GIF89a'), 'image/gif')).status).toBe(415);
    expect(
      (await uploadLogo(auth, Buffer.from('<script>1</script>'), 'image/svg+xml')).status,
    ).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect((await uploadLogo(auth, big, 'image/png')).status).toBe(413);
  });

  it('solo company_admin sube el logo', async () => {
    const { admin } = await companyWith(['operator']);
    expect((await uploadLogo(admin.auth, PNG, 'image/png')).status).toBe(403);
  });
});

describe('GET /api/public/logos', () => {
  it('responde 404 a logos inexistentes y rutas manipuladas', async () => {
    const { company } = await companyWith();
    for (const path of [
      `/api/public/logos/${company.id}/00000000-0000-4000-8000-000000000000.png`,
      `/api/public/logos/${company.id}/..%2F..%2Fsecreto`,
      '/api/public/logos/no-es-uuid/logo.png',
      `/api/public/logos/${company.id}/logo.exe`,
    ]) {
      expect((await request(ctx.app).get(path)).status, path).toBe(404);
    }
  });
});

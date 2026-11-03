import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Exportar los datos de una empresa y borrarla definitivamente (docs/plan-lanzamiento.md 3.7).
// El trabajo pesado lo hace el worker (apps/worker/test/company-data.int.test.ts); aquí, las
// rutas: permisos, disponibilidad de la descarga y confirmaciones.

let ctx: TestContext;
let superAuth: string;
beforeAll(async () => {
  ctx = await createTestContext();
  const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
  superAuth = `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`;
});
afterAll(() => ctx.close());

const DAY = 24 * 60 * 60 * 1000;

async function companyWithAdmin() {
  const company = await createCompany(ctx.owner);
  const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
  const operator = await createUser(ctx.owner, { companyId: company.id, role: 'operator' });
  return {
    company,
    auth: `Bearer ${await tokenFor(admin, ctx.clock.current)}`,
    operatorAuth: `Bearer ${await tokenFor(operator, ctx.clock.current)}`,
  };
}

/** Exportación terminada como la deja el worker. */
async function finishedExport(companyId: string, finishedAt: Date, key?: string) {
  const storageKey = key ?? `exports/${companyId}/${finishedAt.getTime()}.zip`;
  await ctx.storage.put(storageKey, Buffer.from('PK-zip'), 'application/zip');
  return ctx.owner.jobRun.create({
    data: {
      companyId,
      jobName: 'company.export',
      status: 'succeeded',
      startedAt: new Date(finishedAt.getTime() - 60_000),
      finishedAt,
      stats: { attempt: 0, storage_key: storageKey, size_bytes: 6, files: { 'plantas.csv': 1 } },
    },
  });
}

const get = (path: string, auth: string) =>
  request(ctx.app).get(`/api${path}`).set('Authorization', auth);
const post = (path: string, auth: string, body?: object) =>
  request(ctx.app).post(`/api${path}`).set('Authorization', auth).send(body);

describe('exportar los datos de la empresa', () => {
  it('el administrador la pide: se encola para su empresa y se audita', async () => {
    const { company, auth } = await companyWithAdmin();
    const res = await post('/company/exports', auth, {
      company_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(res.status).toBe(202);
    expect(ctx.jobs.jobs.at(-1)).toEqual({
      name: 'company.export',
      payload: { company_id: company.id },
    });
    expect(
      await ctx.owner.auditLog.count({
        where: { companyId: company.id, action: 'company.export_requested' },
      }),
    ).toBe(1);
  });

  it('solo el administrador puede pedirla, verla y descargarla', async () => {
    const { company, operatorAuth } = await companyWithAdmin();
    const run = await finishedExport(company.id, ctx.clock.current);
    expect((await post('/company/exports', operatorAuth)).status).toBe(403);
    expect((await get('/company/exports', operatorAuth)).status).toBe(403);
    expect((await get(`/company/exports/${run.id}/download`, operatorAuth)).status).toBe(403);
  });

  it('descarga la última por unos días; las anteriores ya no', async () => {
    const { company, auth } = await companyWithAdmin();
    const old = await finishedExport(company.id, new Date(ctx.clock.current.getTime() - 2 * DAY));
    const latest = await finishedExport(company.id, new Date(ctx.clock.current.getTime() - DAY));

    const list = await get('/company/exports', auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([latest.id, old.id]);
    expect(list.body.data[0]).toMatchObject({ status: 'succeeded', size_bytes: 6 });
    expect(list.body.data[0].available_until).not.toBeNull();
    expect(list.body.data[1].available_until).toBeNull();

    const file = await get(`/company/exports/${latest.id}/download`, auth).responseType('blob');
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/zip');
    expect(file.headers['content-disposition']).toContain(`pv-iot-${company.slug}-`);
    expect(Buffer.from(file.body).toString()).toBe('PK-zip');
    expect(
      await ctx.owner.auditLog.count({
        where: { companyId: company.id, action: 'company.export_downloaded' },
      }),
    ).toBe(1);

    expect((await get(`/company/exports/${old.id}/download`, auth)).status).toBe(404);
  });

  it('vence a los 7 días y nunca sirve un archivo de otra empresa', async () => {
    const { company, auth } = await companyWithAdmin();
    const expired = await finishedExport(
      company.id,
      new Date(ctx.clock.current.getTime() - 8 * DAY),
    );
    expect((await get(`/company/exports/${expired.id}/download`, auth)).status).toBe(404);

    const other = await createCompany(ctx.owner);
    const foreign = await finishedExport(
      company.id,
      ctx.clock.current,
      `exports/${other.id}/ajeno.zip`,
    );
    expect((await get(`/company/exports/${foreign.id}/download`, auth)).status).toBe(404);
  });
});

describe('borrado definitivo (superadmin)', () => {
  it('exige la empresa suspendida y el identificador correcto', async () => {
    const company = await createCompany(ctx.owner);
    const active = await post(`/admin/companies/${company.id}/purge`, superAuth, {
      confirm_slug: company.slug,
    });
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe('COMPANY_NOT_SUSPENDED');

    await ctx.owner.company.update({ where: { id: company.id }, data: { status: 'suspended' } });
    const wrong = await post(`/admin/companies/${company.id}/purge`, superAuth, {
      confirm_slug: 'otra-empresa',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');

    const missing = await post(
      '/admin/companies/00000000-0000-4000-8000-000000000000/purge',
      superAuth,
      {
        confirm_slug: 'x',
      },
    );
    expect(missing.status).toBe(404);
    expect(ctx.jobs.jobs.some((j) => j.name === 'company.purge')).toBe(false);
  });

  it('encola el borrado y lo registra como acción de plataforma', async () => {
    const company = await createCompany(ctx.owner, { status: 'suspended' });
    const res = await post(`/admin/companies/${company.id}/purge`, superAuth, {
      confirm_slug: company.slug,
    });
    expect(res.status).toBe(202);
    const job = ctx.jobs.jobs.at(-1);
    expect(job).toMatchObject({ name: 'company.purge', payload: { company_id: company.id } });
    const audit = await ctx.owner.auditLog.findFirstOrThrow({
      where: { action: 'company.purge_requested', entityId: company.id },
    });
    expect(audit).toMatchObject({
      companyId: null,
      userId: (job?.payload as { requested_by: string }).requested_by,
    });
    expect(audit.metadata).toMatchObject({ slug: company.slug });
  });

  it('un administrador de empresa no puede borrar', async () => {
    const { company, auth } = await companyWithAdmin();
    expect(
      (await post(`/admin/companies/${company.id}/purge`, auth, { confirm_slug: company.slug }))
        .status,
    ).toBe(403);
  });

  it('el listado de empresas muestra la última exportación', async () => {
    const company = await createCompany(ctx.owner);
    const finishedAt = new Date(ctx.clock.current.getTime() - DAY);
    await finishedExport(company.id, finishedAt);
    const res = await get('/admin/companies?page_size=100', superAuth);
    const row = res.body.data.find((c: { id: string }) => c.id === company.id);
    expect(row.last_export_at).toBe(finishedAt.toISOString());
  });
});

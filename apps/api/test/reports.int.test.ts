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

// F9-T4 (specs/08 §1, specs/10 §Reportes): lista por cliente, generar, PDF y envío.

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const PERIOD = '2026-09';

async function fleet() {
  const company = await createCompany(ctx.owner);
  const client = (name: string, reportEmail: string | null) =>
    ctx.owner.client.create({
      data: {
        companyId: company.id,
        name,
        reportEmail,
        address: 'Av. Obregón 100',
        colonia: 'Centro',
        postalCode: '80000',
        lat: 24.8069,
        lon: -107.3938,
      },
    });
  const plant = (clientId: string, commissioning: string) =>
    ctx.owner.solarPlant.create({
      data: {
        companyId: company.id,
        clientId,
        name: `Planta ${commissioning}`,
        capacityKwp: 8,
        tiltDeg: 20,
        azimuthDeg: 180,
        inverterBrand: 'simulator',
        postalCode: '80000',
        colonia: 'Centro',
        lat: 24.8069,
        lon: -107.3938,
        commissioningDate: new Date(`${commissioning}T12:00:00Z`),
      },
    });
  const withEmail = await client('Abarrotes El Sol', 'sol@example.com');
  const noEmail = await client('Bodega Norte', null);
  const late = await client('Cliente nuevo', 'nuevo@example.com');
  await plant(withEmail.id, '2026-03-01');
  await plant(withEmail.id, '2026-09-16');
  await plant(noEmail.id, '2026-01-10');
  await plant(late.id, '2026-10-05');
  const users = {} as Record<UserRole, string>;
  for (const role of ['company_admin', 'operator', 'technician'] as const) {
    const user = await createUser(ctx.owner, { companyId: company.id, role });
    users[role] = `Bearer ${await tokenFor(user, ctx.clock.current)}`;
  }
  return { company, withEmail, noEmail, late, users };
}

type Fleet = Awaited<ReturnType<typeof fleet>>;
const jobsFor = (name: string, companyId: string) =>
  ctx.jobs.jobs.filter(
    (j) => j.name === name && (j.payload as { company_id: string }).company_id === companyId,
  );

/** Simula al worker: deja el reporte generado con su PDF en storage. */
async function markGenerated(f: Fleet, reportId: string) {
  const key = `reports/${f.company.id}/${PERIOD}/${reportId}.pdf`;
  await ctx.storage.put(key, Buffer.from('%PDF-1.3 prueba'), 'application/pdf');
  await ctx.owner.monthlyReport.update({
    where: { id: reportId },
    data: { status: 'generated', storageKey: key, narrativeSource: 'template' },
  });
}

describe('GET /reports', () => {
  it('lista los clientes con planta activa en el último mes cerrado', async () => {
    const f = await fleet();
    const res = await request(ctx.app).get('/api/reports').set('Authorization', f.users.operator);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period: PERIOD, can_generate: true, auto_send: false });
    expect(
      res.body.items.map((i: { client: { name: string }; plants: number }) => [
        i.client.name,
        i.plants,
      ]),
    ).toEqual([
      ['Abarrotes El Sol', 2],
      ['Bodega Norte', 1],
    ]);
    expect(res.body.items[0].report).toBeNull();
    const current = await request(ctx.app)
      .get('/api/reports?period=2026-10')
      .set('Authorization', f.users.operator);
    expect(current.body).toMatchObject({ period: '2026-10', can_generate: false });
    expect(current.body.items).toHaveLength(3);
  });

  it('solo company_admin y operator; periodo inválido → 400', async () => {
    const f = await fleet();
    const tech = await request(ctx.app)
      .get('/api/reports')
      .set('Authorization', f.users.technician);
    expect(tech.status).toBe(403);
    const bad = await request(ctx.app)
      .get('/api/reports?period=2026-13')
      .set('Authorization', f.users.operator);
    expect(bad.status).toBe(400);
  });
});

describe('POST /reports/generate', () => {
  it('crea los reportes pendientes y encola su generación', async () => {
    const f = await fleet();
    const res = await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.company_admin)
      .send({ period: PERIOD });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 2, skipped_sent: 0 });
    const reports = await ctx.owner.monthlyReport.findMany({ where: { companyId: f.company.id } });
    expect(reports.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(jobsFor('reports.generate', f.company.id)).toHaveLength(2);
    expect(jobsFor('reports.generate', f.company.id)[0]?.payload).toMatchObject({
      auto_send: false,
    });

    // Regenerar uno: vuelve a pendiente, no crea otro.
    const one = await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.operator)
      .send({ period: PERIOD, client_ids: [f.withEmail.id] });
    expect(one.body).toEqual({ queued: 1, skipped_sent: 0 });
    expect(await ctx.owner.monthlyReport.count({ where: { companyId: f.company.id } })).toBe(2);
  });

  it('no genera el mes en curso, ni enviados, ni clientes de otra empresa', async () => {
    const f = await fleet();
    const current = await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.operator)
      .send({ period: '2026-10' });
    expect(current.status).toBe(422);
    expect(current.body.error.code).toBe('PERIOD_NOT_CLOSED');

    const sent = await ctx.owner.monthlyReport.create({
      data: { companyId: f.company.id, clientId: f.withEmail.id, period: PERIOD, status: 'sent' },
    });
    const res = await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.operator)
      .send({ period: PERIOD });
    expect(res.body).toEqual({ queued: 1, skipped_sent: 1 });
    expect((await ctx.owner.monthlyReport.findUnique({ where: { id: sent.id } }))?.status).toBe(
      'sent',
    );

    const other = await fleet();
    const foreign = await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.operator)
      .send({ period: PERIOD, client_ids: [other.withEmail.id] });
    expect(foreign.status).toBe(404);
    expect(await ctx.owner.monthlyReport.count({ where: { companyId: other.company.id } })).toBe(0);
  });
});

describe('PDF y envío', () => {
  async function generatedReports() {
    const f = await fleet();
    await request(ctx.app)
      .post('/api/reports/generate')
      .set('Authorization', f.users.operator)
      .send({ period: PERIOD });
    const reports = await ctx.owner.monthlyReport.findMany({ where: { companyId: f.company.id } });
    const byClient = (id: string) => reports.find((r) => r.clientId === id)!;
    return {
      ...f,
      withEmailReport: byClient(f.withEmail.id),
      noEmailReport: byClient(f.noEmail.id),
    };
  }

  it('descarga el PDF solo cuando está generado y solo de la empresa', async () => {
    const f = await generatedReports();
    const url = `/api/reports/${f.withEmailReport.id}/pdf`;
    expect((await request(ctx.app).get(url).set('Authorization', f.users.operator)).status).toBe(
      404,
    );
    await markGenerated(f, f.withEmailReport.id);
    const res = await request(ctx.app).get(url).set('Authorization', f.users.operator);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="Reporte-solar-2026-09.pdf"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const download = await request(ctx.app)
      .get(`${url}?download=1`)
      .set('Authorization', f.users.operator);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);

    const other = await fleet();
    expect(
      (await request(ctx.app).get(url).set('Authorization', other.users.operator)).status,
    ).toBe(404);
  });

  it('envía uno: valida estado y correo, audita y encola', async () => {
    const f = await generatedReports();
    const send = (id: string, auth = f.users.operator) =>
      request(ctx.app).post(`/api/reports/${id}/send`).set('Authorization', auth);
    expect((await send(f.withEmailReport.id)).body.error.code).toBe('REPORT_NOT_READY');
    await markGenerated(f, f.withEmailReport.id);
    await markGenerated(f, f.noEmailReport.id);
    expect((await send(f.noEmailReport.id)).body.error.code).toBe('CLIENT_NO_REPORT_EMAIL');

    const ok = await send(f.withEmailReport.id);
    expect(ok.status).toBe(202);
    expect(jobsFor('reports.send', f.company.id).map((j) => j.payload)).toEqual([
      { company_id: f.company.id, report_id: f.withEmailReport.id },
    ]);
    const audit = await ctx.owner.auditLog.findMany({
      where: { companyId: f.company.id, action: 'report.sent' },
    });
    expect(audit.map((a) => [a.entityId, a.metadata])).toEqual([
      [f.withEmailReport.id, { period: PERIOD, client_id: f.withEmail.id }],
    ]);

    await ctx.owner.monthlyReport.update({
      where: { id: f.withEmailReport.id },
      data: { status: 'sent' },
    });
    expect((await send(f.withEmailReport.id)).body.error.code).toBe('REPORT_ALREADY_SENT');

    const other = await fleet();
    expect((await send(f.withEmailReport.id, other.users.operator)).status).toBe(404);
  });

  it('enviar todos: solo los generados con correo', async () => {
    const f = await generatedReports();
    await markGenerated(f, f.withEmailReport.id);
    await markGenerated(f, f.noEmailReport.id);
    const res = await request(ctx.app)
      .post('/api/reports/send-all')
      .set('Authorization', f.users.company_admin)
      .send({ period: PERIOD });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 1, without_email: 1 });
    expect(jobsFor('reports.send', f.company.id)).toHaveLength(1);

    // La lista refleja el estado y un envío fallido.
    await ctx.owner.notification.create({
      data: {
        companyId: f.company.id,
        recipient: 'sol@example.com',
        subject: 's',
        template: 'client_report',
        payload: {},
        relatedType: 'monthly_report',
        relatedId: f.withEmailReport.id,
        status: 'failed',
      },
    });
    const list = await request(ctx.app)
      .get(`/api/reports?period=${PERIOD}`)
      .set('Authorization', f.users.operator);
    expect(list.body.items[0]).toMatchObject({
      client: { name: 'Abarrotes El Sol', report_email: 'sol@example.com' },
      report: {
        status: 'generated',
        has_pdf: true,
        send_failed: true,
        narrative_source: 'template',
      },
    });
    expect(list.body.items[1].report).toMatchObject({ send_failed: false });
  });
});

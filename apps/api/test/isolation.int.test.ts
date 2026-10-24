import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Suite de aislamiento entre empresas (specs/12 §2, bloquea el despliegue). Descubre las rutas
// leyendo src/routes: una ruta nueva con parámetro o una lista nueva hace fallar esta prueba hasta
// que se agregue aquí su caso (o su excepción justificada).

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const ROUTES_DIR = join(import.meta.dirname, '../src/routes');

/** Dónde se monta cada archivo de rutas (src/app.ts). */
const MOUNTS: Record<string, string> = {
  'admin/routes.ts': '/admin',
  'ai/routes.ts': '/ai',
  'alerts/routes.ts': '/alerts',
  'auth/routes.ts': '/auth',
  'clients/routes.ts': '/clients',
  'company/profile-routes.ts': '/company',
  'company/routes.ts': '/company',
  'dashboard/routes.ts': '/dashboard',
  'me/routes.ts': '/me',
  'plants/charts.ts': '/plants',
  'plants/routes.ts': '/plants',
  'reports/routes.ts': '/reports',
  'tickets/routes.ts': '/tickets',
};

function sourceFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(join(dir, name)).isDirectory()
      ? sourceFiles(join(dir, name), rel)
      : rel.endsWith('.ts') && !rel.endsWith('.test.ts')
        ? [rel]
        : [];
  });
}

/** "METHOD /ruta/completa" de cada ruta definida en src/routes. */
function discoverRoutes(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(ROUTES_DIR)) {
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      const [, method = '', path = ''] = m;
      // El router público de logos vive en el mismo archivo que el perfil de la empresa.
      const mount =
        file === 'company/profile-routes.ts' && path.startsWith('/:companyId')
          ? '/public/logos'
          : MOUNTS[file];
      if (!mount) throw new Error(`Archivo de rutas sin montaje conocido: ${file}`);
      out.push(`${method.toUpperCase()} ${mount}${path === '/' ? '' : path}`);
    }
  }
  return out.sort();
}

/** Rutas con parámetro que no son recursos de una empresa, con su razón. */
const PARAM_EXEMPT: Record<string, string> = {
  'GET /auth/invitations/:token': 'pública; el token aleatorio es la credencial',
  'POST /auth/invitations/:token/accept': 'pública; el token aleatorio es la credencial',
  'GET /public/logos/:companyId/:file': 'pública por diseño (correos y PDFs); nombre aleatorio',
  'PATCH /admin/companies/:id': 'solo superadmin (plataforma); probada en admin.int.test.ts',
};

/** Listas (GET sin parámetro) que no aplican a un usuario de empresa, con su razón. */
const LIST_EXEMPT: Record<string, string> = {
  'GET /admin/companies': 'solo superadmin; sin datos operativos (admin.int.test.ts)',
  'GET /admin/health': 'solo superadmin; sin datos operativos (admin.int.test.ts)',
};

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Empresa con un recurso de cada tipo; los nombres llevan una marca para buscarlos. */
async function tenant(tag: string) {
  const company = await createCompany(ctx.owner, { name: `Empresa ${tag}` });
  const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
  const operator = await createUser(ctx.owner, { companyId: company.id, role: 'operator' });
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: `Cliente ${tag}`,
      address: `Calle ${tag}`,
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
      reportEmail: `cliente-${tag}@example.com`,
    },
  });
  const plant = await ctx.owner.solarPlant.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: `Planta ${tag}`,
      capacityKwp: 8,
      tiltDeg: 20,
      azimuthDeg: 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
      lat: 24.8,
      lon: -107.39,
      commissioningDate: new Date('2026-03-01T12:00:00Z'),
    },
  });
  const alert = await ctx.owner.alert.create({
    data: {
      companyId: company.id,
      plantId: plant.id,
      type: 'soiling',
      severity: 'warning',
      detectedAt: new Date('2026-10-20T15:00:00Z'),
      evidence: { rule: 'soiling' },
    },
  });
  const ticket = await ctx.owner.maintenanceTicket.create({
    data: { companyId: company.id, plantId: plant.id, type: 'cleaning', title: `Lavado ${tag}` },
  });
  const event = await ctx.owner.plantEvent.create({
    data: {
      companyId: company.id,
      plantId: plant.id,
      type: 'note',
      source: 'manual',
      occurredAt: new Date('2026-10-01T15:00:00Z'),
      notes: `Nota ${tag}`,
    },
  });
  const key = `reports/${company.id}/2026-09/${ID(1)}.pdf`;
  await ctx.storage.put(key, Buffer.from(`%PDF- ${tag}`), 'application/pdf');
  const report = await ctx.owner.monthlyReport.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      period: '2026-09',
      status: 'generated',
      storageKey: key,
      narrative: `Narrativa ${tag}`,
    },
  });
  const conversation = await ctx.owner.aiConversation.create({
    data: { companyId: company.id, userId: admin.id, title: `Conversación ${tag}` },
  });
  const invitation = await ctx.owner.invitation.create({
    data: {
      companyId: company.id,
      email: `invitado-${tag}@example.com`,
      role: 'operator',
      tokenHash: `hash-${tag}-${Date.now()}`,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    },
  });
  return {
    company,
    admin,
    operator,
    client,
    plant,
    alert,
    ticket,
    event,
    report,
    conversation,
    invitation,
    tag,
    auth: `Bearer ${await tokenFor(admin, ctx.clock.current)}`,
    /** Ids y textos que nunca deben aparecer en respuestas a otra empresa. */
    secrets: [
      company.id,
      admin.id,
      operator.id,
      client.id,
      plant.id,
      alert.id,
      ticket.id,
      event.id,
      report.id,
      conversation.id,
      invitation.id,
      admin.email,
      `invitado-${tag}@example.com`,
      `cliente-${tag}@example.com`,
      tag,
    ],
  };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** Una petición de A sobre un recurso de B: método, ruta con el id de B y cuerpo válido. */
type CrossCase = { route: string; path: (b: Tenant) => string; body?: object };

const CROSS: CrossCase[] = [
  { route: 'DELETE /ai/conversations/:id', path: (b) => `/ai/conversations/${b.conversation.id}` },
  { route: 'GET /ai/conversations/:id', path: (b) => `/ai/conversations/${b.conversation.id}` },
  { route: 'GET /alerts/:id', path: (b) => `/alerts/${b.alert.id}` },
  { route: 'POST /alerts/:id/acknowledge', path: (b) => `/alerts/${b.alert.id}/acknowledge` },
  {
    route: 'POST /alerts/:id/dismiss',
    path: (b) => `/alerts/${b.alert.id}/dismiss`,
    body: { reason: 'Motivo de la prueba' },
  },
  {
    route: 'POST /alerts/:id/regenerate-explanation',
    path: (b) => `/alerts/${b.alert.id}/regenerate-explanation`,
  },
  { route: 'POST /alerts/:id/ticket', path: (b) => `/alerts/${b.alert.id}/ticket`, body: {} },
  { route: 'DELETE /clients/:id', path: (b) => `/clients/${b.client.id}` },
  { route: 'GET /clients/:id', path: (b) => `/clients/${b.client.id}` },
  { route: 'PATCH /clients/:id', path: (b) => `/clients/${b.client.id}`, body: { name: 'Cambio' } },
  {
    route: 'PATCH /company/users/:id',
    path: (b) => `/company/users/${b.operator.id}`,
    body: { role: 'technician' },
  },
  { route: 'DELETE /plants/:id', path: (b) => `/plants/${b.plant.id}` },
  { route: 'GET /plants/:id', path: (b) => `/plants/${b.plant.id}` },
  { route: 'PATCH /plants/:id', path: (b) => `/plants/${b.plant.id}`, body: { name: 'Cambio' } },
  { route: 'GET /plants/:id/daily-metrics', path: (b) => `/plants/${b.plant.id}/daily-metrics` },
  { route: 'GET /plants/:id/today', path: (b) => `/plants/${b.plant.id}/today` },
  { route: 'GET /plants/:id/events', path: (b) => `/plants/${b.plant.id}/events` },
  {
    route: 'POST /plants/:id/events',
    path: (b) => `/plants/${b.plant.id}/events`,
    body: { type: 'note', occurred_at: '2026-10-02T15:00:00Z', notes: 'x' },
  },
  {
    route: 'PUT /plants/:id/credentials',
    path: (b) => `/plants/${b.plant.id}/credentials`,
    body: { credentials: { api_key: 'secreto-de-prueba' } },
  },
  {
    route: 'POST /plants/:id/credentials/test',
    path: (b) => `/plants/${b.plant.id}/credentials/test`,
  },
  { route: 'GET /reports/:id/pdf', path: (b) => `/reports/${b.report.id}/pdf` },
  { route: 'POST /reports/:id/send', path: (b) => `/reports/${b.report.id}/send` },
  { route: 'GET /tickets/:id', path: (b) => `/tickets/${b.ticket.id}` },
  {
    route: 'PATCH /tickets/:id',
    path: (b) => `/tickets/${b.ticket.id}`,
    body: { status: 'in_progress' },
  },
];

/** Listas que un company_admin de A puede pedir; con `company_id` de B en la query. */
const LISTS: Record<string, (b: Tenant) => string> = {
  'GET /ai/conversations': () => '/ai/conversations',
  'GET /alerts': () => '/alerts?page_size=100',
  'GET /clients': () => '/clients?page_size=100',
  'GET /company': () => '/company',
  'GET /company/ai-usage': () => '/company/ai-usage',
  'GET /company/invitations': () => '/company/invitations',
  'GET /company/users': () => '/company/users?page_size=100',
  'GET /dashboard/map': () => '/dashboard/map',
  'GET /dashboard/summary': () => '/dashboard/summary',
  'GET /dashboard/top-bottom': () => '/dashboard/top-bottom',
  'GET /dashboard/upcoming-cleanings': () => '/dashboard/upcoming-cleanings',
  'GET /me': () => '/me',
  'GET /plants': () => '/plants?page_size=100',
  'GET /reports': () => '/reports?period=2026-09',
  'GET /tickets': () => '/tickets?page_size=100',
  'GET /tickets/assignees': () => '/tickets/assignees',
};

let A: Tenant;
let B: Tenant;
beforeAll(async () => {
  A = await tenant(`emp-a-${Date.now()}`);
  B = await tenant(`emp-b-${Date.now()}`);
});

const send = (method: string, path: string, auth: string, body?: object) => {
  const req = request(ctx.app)[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
    `/api${path}`,
  );
  req.set('Authorization', auth);
  return body ? req.send(body) : req;
};

describe('cobertura de la suite', () => {
  const routes = discoverRoutes();

  it('descubre las rutas de la API', () => {
    expect(routes.length).toBeGreaterThan(50);
    // El montaje de la tabla coincide con src/app.ts.
    const app = readFileSync(join(import.meta.dirname, '../src/app.ts'), 'utf8');
    for (const mount of new Set([...Object.values(MOUNTS), '/public/logos'])) {
      expect(app, mount).toContain(`'${mount}'`);
    }
  });

  it('cada ruta con parámetro tiene caso entre empresas o excepción', () => {
    const covered = new Set([...CROSS.map((c) => c.route), ...Object.keys(PARAM_EXEMPT)]);
    expect(routes.filter((r) => r.includes('/:') && !covered.has(r))).toEqual([]);
    // Y la tabla no tiene casos de rutas que ya no existen.
    expect([...covered].filter((r) => !routes.includes(r))).toEqual([]);
  });

  it('cada lista (GET sin parámetro) está revisada o exenta', () => {
    const covered = new Set([...Object.keys(LISTS), ...Object.keys(LIST_EXEMPT)]);
    expect(
      routes.filter((r) => r.startsWith('GET ') && !r.includes('/:') && !covered.has(r)),
    ).toEqual([]);
    expect([...covered].filter((r) => !routes.includes(r))).toEqual([]);
  });
});

describe('aislamiento entre empresas', () => {
  it.each(CROSS.map((c) => [c.route, c] as const))(
    '%s con un recurso de otra empresa → 404',
    async (_route, c) => {
      const method = c.route.split(' ')[0] as string;
      const res = await send(method, c.path(B), A.auth, c.body);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      for (const secret of B.secrets) expect(JSON.stringify(res.body)).not.toContain(secret);
    },
  );

  it('los recursos de B siguen intactos', async () => {
    const [client, plant, alert, ticket, conversation, operator, report, credentials] =
      await Promise.all([
        ctx.owner.client.findUnique({ where: { id: B.client.id } }),
        ctx.owner.solarPlant.findUnique({ where: { id: B.plant.id } }),
        ctx.owner.alert.findUnique({ where: { id: B.alert.id } }),
        ctx.owner.maintenanceTicket.findUnique({ where: { id: B.ticket.id } }),
        ctx.owner.aiConversation.findUnique({ where: { id: B.conversation.id } }),
        ctx.owner.user.findUnique({ where: { id: B.operator.id } }),
        ctx.owner.monthlyReport.findUnique({ where: { id: B.report.id } }),
        ctx.owner.inverterCredential.count({ where: { plantId: B.plant.id } }),
      ]);
    expect(client).toMatchObject({ name: `Cliente ${B.tag}`, deletedAt: null });
    expect(plant).toMatchObject({ name: `Planta ${B.tag}`, deletedAt: null });
    expect(alert?.status).toBe('open');
    expect(alert?.ticketId).toBeNull();
    expect(ticket?.status).toBe(B.ticket.status);
    expect(conversation).not.toBeNull();
    expect(operator?.role).toBe('operator');
    expect(report?.status).toBe('generated');
    expect(credentials).toBe(0);
    expect(await ctx.owner.plantEvent.count({ where: { plantId: B.plant.id } })).toBe(1);
    expect(ctx.jobs.jobs.some((j) => JSON.stringify(j.payload).includes(B.company.id))).toBe(false);
  });

  it.each(Object.entries(LISTS))(
    '%s no trae datos de otra empresa, ni con company_id en la query',
    async (_route, path) => {
      const base = path(B);
      const withQuery = `${base}${base.includes('?') ? '&' : '?'}company_id=${B.company.id}`;
      for (const p of [base, withQuery]) {
        const res = await send('GET', p, A.auth);
        expect(res.status, `${p}: ${JSON.stringify(res.body)}`).toBe(200);
        const body = JSON.stringify(res.body);
        for (const secret of B.secrets)
          expect(body, `${p} contiene ${secret}`).not.toContain(secret);
      }
    },
  );

  it('company_id en el cuerpo no cambia la empresa del recurso creado', async () => {
    const res = await send('POST', '/clients', A.auth, {
      company_id: B.company.id,
      name: 'Cliente con company_id ajeno',
      address: 'x',
      colonia: 'Centro',
      postal_code: '80000',
      lat: 24.8,
      lon: -107.39,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await ctx.owner.client.findUnique({ where: { id: res.body.id } });
    expect(row?.companyId).toBe(A.company.id);
  });
});

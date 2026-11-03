import { companyExport } from '@pv/adapters';
import { parseCsv } from '@pv/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCompanyExport, runCompanyExport } from '../src/company-export.js';
import { CompanyNotSuspendedError, purgeCompany } from '../src/company-purge.js';
import { companyExportJob } from '../src/jobs/company.js';
import { runJob } from '../src/runtime.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  TEST_CIPHER,
  type WorkerTestContext,
} from './helpers.js';

// Exportación y borrado definitivo de una empresa (docs/plan-lanzamiento.md 3.7).

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
});
afterAll(() => ctx.close());

/** Empresa con un dato de cada tabla, un logo y un PDF guardados. */
async function fullCompany(tag: string) {
  const { company, client } = await createCompanyWithClient(ctx.owner);
  await ctx.owner.client.update({ where: { id: client.id }, data: { name: `Cliente ${tag}` } });
  const plant = await createPlant(ctx.owner, company.id, client.id);
  await ctx.owner.solarPlant.update({ where: { id: plant.id }, data: { name: `Planta ${tag}` } });
  const user = await ctx.owner.user.create({
    data: {
      companyId: company.id,
      email: `admin-${tag}-${Date.now()}@ejemplo.mx`,
      name: `Admin ${tag}`,
      role: 'company_admin',
      status: 'active',
      passwordHash: `$argon2id$hash-secreto-${tag}`,
    },
  });
  await ctx.owner.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: `rt-${tag}-${Date.now()}`,
      expiresAt: new Date('2027-01-01'),
    },
  });
  const enc = TEST_CIPHER.encrypt(
    { username: 'u', password: `clave-portal-${tag}` },
    { companyId: company.id, plantId: plant.id },
  );
  await ctx.owner.inverterCredential.create({
    data: { companyId: company.id, plantId: plant.id, provider: 'goodwe', ...enc },
  });
  await ctx.owner.companyIntegration.create({
    data: {
      companyId: company.id,
      provider: 'goodwe',
      ...TEST_CIPHER.encrypt(
        { client_id: `cliente-${tag}`, client_secret: `secreto-goodwe-${tag}`, region: 'us' },
        { companyId: company.id, integration: 'goodwe' },
      ),
    },
  });
  const base = { companyId: company.id, plantId: plant.id };
  await ctx.owner.telemetryReading.createMany({
    data: [0, 1, 2].map((i) => ({
      ...base,
      ts: new Date(Date.UTC(2026, 9, 20, 18, 15 * i)),
      powerKw: 3.2,
      energyKwh: 0.8,
    })),
  });
  await ctx.owner.plantWeatherHourly.create({
    data: {
      ...base,
      ts: new Date('2026-10-20T18:00:00Z'),
      poaWm2: 800,
      ghiWm2: 750,
      tempAmbC: 31,
      cloudCoverPct: 10,
      precipitationMm: 0,
      source: 'synthetic',
    },
  });
  await ctx.owner.plantDailyMetric.create({
    data: {
      ...base,
      clientId: client.id,
      date: new Date('2026-10-20'),
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 30,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 30,
      expectedTempKwh: 28,
      specificYieldKwhKwp: 6,
      status: 'ok',
    },
  });
  const alert = await ctx.owner.alert.create({
    data: { ...base, type: 'soiling', severity: 'warning', evidence: { tag } },
  });
  const ticket = await ctx.owner.maintenanceTicket.create({
    data: {
      ...base,
      alertId: alert.id,
      type: 'cleaning',
      title: `Limpieza ${tag}`,
      assignedToId: user.id,
    },
  });
  await ctx.owner.alert.update({ where: { id: alert.id }, data: { ticketId: ticket.id } });
  await ctx.owner.plantEvent.create({
    data: {
      ...base,
      type: 'cleaning',
      occurredAt: new Date(),
      source: 'ticket',
      ticketId: ticket.id,
    },
  });
  await ctx.owner.notification.create({
    data: { companyId: company.id, recipient: 'x@ejemplo.mx', subject: 's', template: 't' },
  });
  const pdfKey = `reports/${company.id}/${tag}.pdf`;
  await ctx.storage.put(pdfKey, Buffer.from('pdf'), 'application/pdf');
  await ctx.owner.monthlyReport.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      period: '2026-09',
      status: 'generated',
      storageKey: pdfKey,
    },
  });
  const conversation = await ctx.owner.aiConversation.create({
    data: { companyId: company.id, userId: user.id, title: 'Pregunta' },
  });
  await ctx.owner.aiMessage.create({
    data: {
      companyId: company.id,
      conversationId: conversation.id,
      role: 'user',
      content: { text: 'hola' },
    },
  });
  await ctx.owner.aiUsageMonthly.create({
    data: { companyId: company.id, period: '2026-10', feature: 'chat', inputTokens: 10n },
  });
  await ctx.owner.invitation.create({
    data: {
      companyId: company.id,
      email: `nuevo-${tag}@ejemplo.mx`,
      role: 'operator',
      tokenHash: `inv-${tag}-${Date.now()}`,
      expiresAt: new Date('2027-01-01'),
    },
  });
  await ctx.owner.auditLog.create({
    data: { companyId: company.id, userId: user.id, action: 'auth.login', ip: '10.0.0.1' },
  });
  await ctx.owner.jobRun.create({
    data: { companyId: company.id, jobName: 'ingest.weather_company' },
  });
  const logoKey = `logos/${company.id}/logo.png`;
  await ctx.storage.put(logoKey, Buffer.from('png'), 'image/png');
  await ctx.owner.company.update({
    where: { id: company.id },
    data: { logoUrl: `https://app.pv-iot.example/api/public/logos/${company.id}/logo.png` },
  });
  return { company, client, plant, user, pdfKey, logoKey };
}

type Full = Awaited<ReturnType<typeof fullCompany>>;

/** Filas de la empresa en cada tabla con company_id. */
async function countsOf(companyId: string) {
  const where = { where: { companyId } };
  const o = ctx.owner;
  return {
    clients: await o.client.count(where),
    plants: await o.solarPlant.count(where),
    credentials: await o.inverterCredential.count(where),
    integrations: await o.companyIntegration.count(where),
    telemetry: await o.telemetryReading.count(where),
    weather: await o.plantWeatherHourly.count(where),
    metrics: await o.plantDailyMetric.count(where),
    events: await o.plantEvent.count(where),
    alerts: await o.alert.count(where),
    tickets: await o.maintenanceTicket.count(where),
    notifications: await o.notification.count(where),
    reports: await o.monthlyReport.count(where),
    conversations: await o.aiConversation.count(where),
    messages: await o.aiMessage.count(where),
    usage: await o.aiUsageMonthly.count(where),
    invitations: await o.invitation.count(where),
    users: await o.user.count(where),
    audit: await o.auditLog.count(where),
    jobRuns: await o.jobRun.count(where),
    companies: await o.company.count({ where: { id: companyId } }),
  };
}

let A: Full;
let B: Full;
beforeAll(async () => {
  A = await fullCompany('a');
  B = await fullCompany('b');
});

const csv = (files: Record<string, Uint8Array>, name: string) => {
  const file = files[name];
  if (!file) throw new Error(`falta ${name}`);
  return parseCsv(strFromU8(file));
};

describe('exportación de los datos de una empresa', () => {
  it('arma un CSV por tabla, solo con datos de la empresa y sin secretos', async () => {
    const { zip, files } = await buildCompanyExport(ctx.db, A.company.id, new Date());
    const unzipped = unzipSync(new Uint8Array(zip));
    expect(Object.keys(unzipped).sort()).toEqual(
      [
        'LEEME.txt',
        'alertas.csv',
        'auditoria.csv',
        'clientes.csv',
        'clima_por_hora.csv',
        'conversaciones_ia.csv',
        'empresa.csv',
        'eventos_planta.csv',
        'lecturas_15min.csv',
        'mensajes_ia.csv',
        'metricas_diarias.csv',
        'notificaciones.csv',
        'plantas.csv',
        'reportes_mensuales.csv',
        'tickets.csv',
        'uso_ia.csv',
        'usuarios.csv',
      ].sort(),
    );
    expect(files).toMatchObject({
      'empresa.csv': 1,
      'usuarios.csv': 1,
      'clientes.csv': 1,
      'plantas.csv': 1,
      'lecturas_15min.csv': 3,
      'tickets.csv': 1,
    });

    const plants = csv(unzipped, 'plantas.csv');
    expect(plants.headers).toContain('capacity_kwp');
    expect(plants.rows.map((r) => r[plants.headers.indexOf('name')])).toEqual(['Planta a']);
    const users = csv(unzipped, 'usuarios.csv');
    expect(users.headers).not.toContain('password_hash');
    expect(users.headers).toEqual(expect.arrayContaining(['email', 'role', 'terms_version']));
    expect(csv(unzipped, 'reportes_mensuales.csv').headers).not.toContain('storage_key');
    expect(
      csv(unzipped, 'lecturas_15min.csv').rows[0]?.[
        csv(unzipped, 'lecturas_15min.csv').headers.indexOf('power_kw')
      ],
    ).toBe('3.2');

    const all = Object.values(unzipped)
      .map((f) => strFromU8(f))
      .join('\n');
    for (const secret of [
      'hash-secreto',
      'secreto-goodwe',
      'clave-portal',
      'inv-a-',
      'rt-a-',
      'Planta b',
      'Cliente b',
    ]) {
      expect(all, secret).not.toContain(secret);
    }
    expect(strFromU8(unzipped['LEEME.txt'] ?? new Uint8Array())).toContain('lecturas_15min.csv');
  });

  it('el job guarda el archivo y borra los viejos, salvo el de la exportación anterior', async () => {
    let at = Date.now();
    const record = (stats: object) =>
      ctx.owner.jobRun.create({
        data: {
          companyId: A.company.id,
          jobName: companyExport.name,
          status: 'succeeded',
          startedAt: new Date((at += 1000)),
          finishedAt: new Date(at + 500),
          stats,
        },
      });
    const first = await runCompanyExport(ctx.deps, A.company.id);
    expect(first.storage_key).toMatch(new RegExp(`^exports/${A.company.id}/.+\\.zip$`));
    await record(first);
    // Mientras corre la segunda, la primera sigue en pantalla: su archivo no se borra.
    const second = await runCompanyExport(ctx.deps, A.company.id);
    expect(ctx.storage.objects.has(first.storage_key)).toBe(true);
    expect(ctx.storage.objects.get(second.storage_key)?.contentType).toBe('application/zip');
    await record(second);
    const third = await runCompanyExport(ctx.deps, A.company.id);
    expect(ctx.storage.objects.has(first.storage_key)).toBe(false);
    expect(ctx.storage.objects.has(second.storage_key)).toBe(true);
    await record(third);
  });
});

describe('borrado definitivo', () => {
  it('se niega con la empresa activa y no borra nada', async () => {
    const before = await countsOf(A.company.id);
    await expect(purgeCompany(ctx.jobContext(null), A.company.id, A.user.id)).rejects.toThrow(
      CompanyNotSuspendedError,
    );
    expect(await countsOf(A.company.id)).toEqual(before);
    expect(ctx.storage.objects.has(A.logoKey)).toBe(true);
  });

  it('borra todo lo de la empresa suspendida, sus archivos, y deja un registro de plataforma', async () => {
    const superadmin = await ctx.owner.user.create({
      data: { email: `sa-${Date.now()}@pv.mx`, name: 'SA', role: 'superadmin', status: 'active' },
    });
    // Un inicio de sesión fallido de plataforma que menciona a la empresa no se toca.
    const platform = await ctx.owner.auditLog.create({
      data: { companyId: null, action: 'auth.login_failed', metadata: { email: 'x@y.mx' } },
    });
    await ctx.owner.company.update({ where: { id: A.company.id }, data: { status: 'suspended' } });
    const bBefore = await countsOf(B.company.id);
    const exportKeys = [...ctx.storage.objects.keys()].filter((k) =>
      k.startsWith(`exports/${A.company.id}/`),
    );
    expect(exportKeys.length).toBe(2);

    const result = await purgeCompany(ctx.jobContext(null), A.company.id, superadmin.id);
    // Logo, PDF y las tres exportaciones registradas (la primera ya no existía: borrarla no falla).
    expect(result).toMatchObject({ slug: A.company.slug, files: 5 });
    expect(result?.counts).toMatchObject({ telemetry_readings: 3, solar_plants: 1, users: 1 });

    expect(Object.values(await countsOf(A.company.id)).every((n) => n === 0)).toBe(true);
    expect(await ctx.owner.refreshToken.count({ where: { userId: A.user.id } })).toBe(0);
    for (const key of [A.logoKey, A.pdfKey, ...exportKeys]) {
      expect(ctx.storage.objects.has(key), key).toBe(false);
    }
    // B intacta, con sus archivos.
    expect(await countsOf(B.company.id)).toEqual(bBefore);
    expect(ctx.storage.objects.has(B.logoKey)).toBe(true);
    expect(ctx.storage.objects.has(B.pdfKey)).toBe(true);

    const log = await ctx.owner.auditLog.findFirst({
      where: { action: 'company.purged', entityId: A.company.id },
    });
    expect(log).toMatchObject({ companyId: null, userId: superadmin.id });
    expect(log?.metadata).toMatchObject({ name: A.company.name, slug: A.company.slug });
    expect(await ctx.owner.auditLog.count({ where: { id: platform.id } })).toBe(1);

    // Un reintento después de terminar no hace nada.
    expect(await purgeCompany(ctx.jobContext(null), A.company.id, superadmin.id)).toBeNull();
  });

  it('un job pendiente de la empresa borrada se omite sin referirla', async () => {
    const outcome = await runJob(companyExportJob, { company_id: A.company.id }, 0, ctx.deps);
    expect(outcome).toBe('skipped');
    const run = await ctx.owner.jobRun.findFirst({
      where: { jobName: companyExport.name, companyId: null },
      orderBy: { startedAt: 'desc' },
    });
    expect(run?.stats).toMatchObject({ reason: 'company_not_found', company_id: A.company.id });
  });
});

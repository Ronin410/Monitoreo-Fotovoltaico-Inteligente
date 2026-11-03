import { companyExportStats, type StorageProvider } from '@pv/adapters';
import { withTenant, type PrismaClient } from '@pv/db';
import type { Logger } from 'pino';
import { EXPORT_JOB_NAME } from './company-export.js';

// Borrado definitivo de una empresa al terminar el contrato (docs/plan-lanzamiento.md 3.7).
//
// - Solo una empresa suspendida: el superadmin la suspende primero (sus sesiones se revocan y sus
//   jobs se detienen) y la base rechaza borrar filas de plataforma de una empresa activa.
// - Los datos operativos se borran con pv_app dentro de withTenant: RLS los limita a esa empresa.
// - Después, con pv_service: auditoría, usuarios y la empresa (invitaciones y job_runs se van con
//   ella). Queda un único registro de plataforma `company.purged` con nombre y conteos.
// - Cada paso es idempotente: si algo falla, el reintento sigue donde se quedó.

export class CompanyNotSuspendedError extends Error {
  constructor() {
    super('Solo se puede borrar definitivamente una empresa suspendida');
    this.name = 'CompanyNotSuspendedError';
  }
}

type Deps = {
  db: PrismaClient;
  serviceDb: PrismaClient;
  storage: StorageProvider;
  log: Logger;
};

const TX = { timeout: 60_000 };

/** Llaves de archivos de la empresa: logo, PDFs de reportes y exportaciones. */
async function storageKeys(deps: Deps, companyId: string, logoUrl: string | null) {
  const keys = new Set<string>();
  const logo = logoUrl?.match(new RegExp(`/logos/${companyId}/([A-Za-z0-9_.-]+)$`))?.[1];
  if (logo) keys.add(`logos/${companyId}/${logo}`);
  const reports = await withTenant(deps.db, companyId, (tx) =>
    tx.monthlyReport.findMany({
      where: { storageKey: { not: null } },
      select: { storageKey: true },
    }),
  );
  for (const r of reports) if (r.storageKey) keys.add(r.storageKey);
  const exports = await deps.serviceDb.jobRun.findMany({
    where: { companyId, jobName: EXPORT_JOB_NAME, status: 'succeeded' },
    select: { stats: true },
  });
  for (const run of exports) {
    const stats = companyExportStats.safeParse(run.stats);
    if (stats.success) keys.add(stats.data.storage_key);
  }
  return [...keys];
}

/** Datos operativos, en orden de llaves foráneas; las series grandes, planta por planta. */
async function purgeTenantData(deps: Deps, companyId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const add = (name: string, n: number) => (counts[name] = (counts[name] ?? 0) + n);

  const plants = await withTenant(deps.db, companyId, (tx) =>
    tx.solarPlant.findMany({ select: { id: true } }),
  );
  for (const { id: plantId } of plants) {
    await withTenant(
      deps.db,
      companyId,
      async (tx) => {
        add(
          'telemetry_readings',
          (await tx.telemetryReading.deleteMany({ where: { plantId } })).count,
        );
        add(
          'plant_weather_hourly',
          (await tx.plantWeatherHourly.deleteMany({ where: { plantId } })).count,
        );
        add(
          'plant_daily_metrics',
          (await tx.plantDailyMetric.deleteMany({ where: { plantId } })).count,
        );
      },
      TX,
    );
  }

  await withTenant(
    deps.db,
    companyId,
    async (tx) => {
      add('ai_messages', (await tx.aiMessage.deleteMany({})).count);
      add('ai_conversations', (await tx.aiConversation.deleteMany({})).count);
      add('ai_usage_monthly', (await tx.aiUsageMonthly.deleteMany({})).count);
      add('notifications', (await tx.notification.deleteMany({})).count);
      add('monthly_reports', (await tx.monthlyReport.deleteMany({})).count);
      add('plant_events', (await tx.plantEvent.deleteMany({})).count);
      add('alerts', (await tx.alert.deleteMany({})).count);
      add('maintenance_tickets', (await tx.maintenanceTicket.deleteMany({})).count);
      add('inverter_credentials', (await tx.inverterCredential.deleteMany({})).count);
      add('company_integrations', (await tx.companyIntegration.deleteMany({})).count);
      // Métricas que hubieran quedado de plantas creadas durante el borrado.
      add('plant_daily_metrics', (await tx.plantDailyMetric.deleteMany({})).count);
      add('solar_plants', (await tx.solarPlant.deleteMany({})).count);
      add('clients', (await tx.client.deleteMany({})).count);
      add('invitations', (await tx.invitation.deleteMany({})).count);
    },
    TX,
  );
  return counts;
}

export type PurgeResult = {
  name: string;
  slug: string;
  files: number;
  counts: Record<string, number>;
};

/** Borra la empresa y todo lo suyo. Lanza CompanyNotSuspendedError si no está suspendida. */
export async function purgeCompany(
  deps: Deps,
  companyId: string,
  requestedBy: string,
): Promise<PurgeResult | null> {
  const company = await deps.serviceDb.company.findUnique({ where: { id: companyId } });
  if (!company) return null; // ya se borró (reintento después de terminar)
  if (company.status !== 'suspended') throw new CompanyNotSuspendedError();

  // 1. Archivos primero: sus llaves salen de filas que se borran después.
  const keys = await storageKeys(deps, companyId, company.logoUrl);
  for (const key of keys) await deps.storage.delete(key);

  // 2. Datos operativos (pv_app, limitado a la empresa).
  const counts = await purgeTenantData(deps, companyId);

  // 3. Plataforma (pv_service), en una transacción; la base solo lo permite si sigue suspendida.
  await deps.serviceDb.$transaction(async (tx) => {
    const current = await tx.company.findUnique({ where: { id: companyId } });
    if (current?.status !== 'suspended') throw new CompanyNotSuspendedError();
    counts.audit_log = (await tx.auditLog.deleteMany({ where: { companyId } })).count;
    // Sus sesiones y tokens de recuperación se borran en cascada.
    counts.users = (await tx.user.deleteMany({ where: { companyId } })).count;
    await tx.company.delete({ where: { id: companyId } });
    await tx.auditLog.create({
      data: {
        action: 'company.purged',
        companyId: null,
        userId: requestedBy,
        entityType: 'company',
        entityId: companyId,
        metadata: { name: company.name, slug: company.slug, files: keys.length, counts },
      },
    });
  }, TX);

  deps.log.info({ company_id: companyId, files: keys.length, counts }, 'empresa borrada');
  return { name: company.name, slug: company.slug, files: keys.length, counts };
}

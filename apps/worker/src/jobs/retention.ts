import { telemetryCleanup, telemetryCleanupCompany } from '@pv/adapters';
import { localDate, startOfLocalDay, telemetryRetentionStart } from '@pv/core';
import { listActiveCompanies, withTenant } from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';

// Retención de lecturas crudas (specs/03 §telemetry_readings, F10-T2): se borran las de más de 13
// meses. Las métricas diarias, el clima por hora y los eventos se conservan.

export const telemetryCleanupJob = registerJob(telemetryCleanup, async (_payload, ctx) => {
  let enqueued = 0;
  for (const company of await listActiveCompanies(ctx.serviceDb)) {
    if (await ctx.queue.enqueue(telemetryCleanupCompany, { company_id: company.id })) enqueued++;
  }
  return { enqueued };
});

/**
 * Borra planta por planta (transacciones cortas, una por planta) para no bloquear la ingesta.
 * Incluye plantas dadas de baja o eliminadas: su telemetría vieja tampoco se conserva.
 */
export async function cleanupCompanyTelemetry(ctx: JobContext, companyId: string) {
  const { plants, keepFrom, cutoff } = await withTenant(ctx.db, companyId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const keepFrom = telemetryRetentionStart(localDate(ctx.now(), company.timezone));
    return {
      keepFrom,
      cutoff: startOfLocalDay(keepFrom, company.timezone),
      plants: await tx.solarPlant.findMany({ select: { id: true } }),
    };
  });
  let deleted = 0;
  for (const plant of plants) {
    const res = await withTenant(ctx.db, companyId, (tx) =>
      tx.telemetryReading.deleteMany({ where: { plantId: plant.id, ts: { lt: cutoff } } }),
    );
    deleted += res.count;
  }
  return { keep_from: keepFrom, plants: plants.length, deleted };
}

export const telemetryCleanupCompanyJob = registerJob(telemetryCleanupCompany, (payload, ctx) =>
  cleanupCompanyTelemetry(ctx, payload.company_id),
);

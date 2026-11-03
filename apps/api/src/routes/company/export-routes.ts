import {
  companyExport,
  companyExportStats,
  EXPORT_DOWNLOAD_DAYS,
  type JobEnqueuer,
  type StorageProvider,
} from '@pv/adapters';
import { withTenant, type JobRun, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';

// Exportación de todos los datos de la empresa (docs/plan-lanzamiento.md 3.7). Solo
// company_admin. El worker arma un ZIP de CSV (job company.export); se conserva solo el último y se
// descarga durante EXPORT_DOWNLOAD_DAYS días.

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 5;

export const companyExportItem = z.object({
  id: z.uuid(),
  status: z.enum(['running', 'succeeded', 'failed', 'skipped']),
  requested_at: z.date(),
  finished_at: z.date().nullable(),
  size_bytes: z.number().int().nullable(),
  /** Hasta cuándo se puede descargar; null si no está disponible. */
  available_until: z.date().nullable(),
});
export const companyExportsResponse = z.object({ data: z.array(companyExportItem) });
export const companyExportQueued = z.object({ queued: z.boolean() });

const notAvailable = () =>
  new HttpError(404, 'NOT_FOUND', 'La exportación no existe o ya no está disponible');

export function companyExportRouter(
  db: PrismaClient,
  storage: StorageProvider,
  jobs: JobEnqueuer,
  now: () => Date,
): Router {
  const router = Router();
  const canExport = requirePermission('company:configure');

  const runs = (companyId: string) =>
    withTenant(db, companyId, (tx) =>
      tx.jobRun.findMany({
        where: { jobName: companyExport.name, status: { not: 'skipped' } },
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      }),
    );

  /** Solo la última exportación terminada conserva su archivo, y por unos días. */
  const availability = (list: JobRun[]) => {
    const latest = list.find((r) => r.status === 'succeeded');
    return (run: JobRun) => {
      if (run !== latest || !run.finishedAt) return null;
      const until = new Date(run.finishedAt.getTime() + EXPORT_DOWNLOAD_DAYS * DAY_MS);
      return until > now() ? until : null;
    };
  };

  router.post('/exports', canExport, async (req, res) => {
    const session = companyAuthOf(req);
    await withTenant(db, session.companyId, (tx) =>
      recordAudit(tx, {
        action: 'company.export_requested',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'company',
        entityId: session.companyId,
        ip: req.ip ?? null,
      }),
    );
    // Una exportación en curso no se duplica (singletonKey por empresa).
    const queued = await jobs.enqueue(companyExport, { company_id: session.companyId });
    respond(res, companyExportQueued, { queued: queued !== null }, 202);
  });

  router.get('/exports', canExport, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const list = await runs(companyId);
    const until = availability(list);
    respond(res, companyExportsResponse, {
      data: list.map((r) => ({
        id: r.id,
        status: r.status,
        requested_at: r.startedAt,
        finished_at: r.finishedAt,
        size_bytes: companyExportStats.safeParse(r.stats).data?.size_bytes ?? null,
        available_until: until(r),
      })),
    });
  });

  router.get('/exports/:id/download', canExport, async (req, res) => {
    const session = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const list = await runs(session.companyId);
    const run = list.find((r) => r.id === id);
    const stats = companyExportStats.safeParse(run?.stats);
    if (!run || !availability(list)(run) || !stats.success) throw notAvailable();
    // Defensa adicional: la llave tiene que ser de esta empresa.
    if (!stats.data.storage_key.startsWith(`exports/${session.companyId}/`)) throw notAvailable();
    const file = await storage.get(stats.data.storage_key);
    if (!file) throw notAvailable();

    const company = await withTenant(db, session.companyId, async (tx) => {
      await recordAudit(tx, {
        action: 'company.export_downloaded',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'company',
        entityId: session.companyId,
        metadata: { export_id: run.id },
        ip: req.ip ?? null,
      });
      return tx.company.findUniqueOrThrow({
        where: { id: session.companyId },
        select: { slug: true },
      });
    });
    const date = (run.finishedAt ?? run.startedAt).toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="pv-iot-${company.slug}-${date}.zip"`,
      'Cache-Control': 'no-store',
    });
    res.send(file.body);
  });

  return router;
}

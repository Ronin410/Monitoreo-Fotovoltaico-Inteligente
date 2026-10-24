import { reportsGenerate, reportsSend, type JobEnqueuer, type StorageProvider } from '@pv/adapters';
import {
  currentPeriod,
  isClosedPeriod,
  parseCompanySettings,
  plantInPeriod,
  shiftPeriod,
} from '@pv/core';
import { withTenant, type PrismaClient, type TenantDb } from '@pv/db';
import { Router } from 'express';
import type { z } from 'zod';
import { recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  generateReportsBody,
  generateReportsResponse,
  reportsQuery,
  reportsResponse,
  sendAllBody,
  sendAllResponse,
  sendReportResponse,
} from './schemas.js';

// Reportes mensuales (F9-T4, specs/08 §1 y specs/10 §Reportes): lista por cliente, generar o
// regenerar (en el worker), descargar el PDF y enviarlo al cliente. Un reporte enviado ya no se
// regenera ni se reenvía.

const reportNotFound = () => new HttpError(404, 'NOT_FOUND', 'Reporte no encontrado');
const notClosed = () =>
  new HttpError(422, 'PERIOD_NOT_CLOSED', 'Solo se generan reportes de meses ya terminados');

/** Clientes con al menos una planta activa en el mes, con sus plantas que cuentan. */
async function eligibleClients(tx: TenantDb, period: string, timeZone: string, ids?: string[]) {
  const clients = await tx.client.findMany({
    where: { deletedAt: null, ...(ids && { id: { in: ids } }) },
    select: {
      id: true,
      name: true,
      reportEmail: true,
      plants: {
        select: { status: true, commissioningDate: true, createdAt: true, deletedAt: true },
      },
    },
    orderBy: { name: 'asc' },
  });
  return clients
    .map((c) => ({ ...c, plants: c.plants.filter((p) => plantInPeriod(p, period, timeZone)) }))
    .filter((c) => c.plants.length > 0);
}

export function reportsRouter(
  db: PrismaClient,
  storage: StorageProvider,
  jobs: JobEnqueuer,
  now: () => Date,
): Router {
  const router = Router();
  const manage = requirePermission('reports:manage');

  router.get('/', manage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const query = reportsQuery.parse(req.query);
    const data = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      // Por defecto el último mes cerrado.
      const period = query.period ?? shiftPeriod(currentPeriod(now(), company.timezone), -1);
      const [clients, reports] = await Promise.all([
        eligibleClients(tx, period, company.timezone),
        tx.monthlyReport.findMany({
          where: { period },
          include: { client: { select: { id: true, name: true, reportEmail: true } } },
        }),
      ]);
      const failed = await tx.notification.findMany({
        where: {
          relatedType: 'monthly_report',
          relatedId: { in: reports.map((r) => r.id) },
          status: 'failed',
        },
        select: { relatedId: true },
      });
      const failedIds = new Set(failed.map((n) => n.relatedId));
      const byClient = new Map(reports.map((r) => [r.clientId, r]));
      const items: z.input<typeof reportsResponse>['items'] = clients.map((c) => ({
        client: { id: c.id, name: c.name, report_email: c.reportEmail },
        plants: c.plants.length,
        report: null,
      }));
      // Un reporte cuyo cliente ya no es elegible (eliminado después) se sigue mostrando.
      const listed = new Set(clients.map((c) => c.id));
      for (const r of reports) {
        if (!listed.has(r.clientId)) {
          items.push({
            client: { id: r.client.id, name: r.client.name, report_email: r.client.reportEmail },
            plants: 0,
            report: null,
          });
        }
      }
      for (const item of items) {
        const r = byClient.get(item.client.id);
        if (!r) continue;
        item.report = {
          id: r.id,
          status: r.status,
          narrative_source: r.narrativeSource,
          has_pdf: r.storageKey !== null,
          sent_to: r.sentTo,
          sent_at: r.sentAt,
          updated_at: r.updatedAt,
          send_failed: r.status !== 'sent' && failedIds.has(r.id),
        };
      }
      items.sort((a, b) => a.client.name.localeCompare(b.client.name, 'es'));
      return {
        period,
        can_generate: isClosedPeriod(period, now(), company.timezone),
        auto_send: parseCompanySettings(company.settings).notifications.auto_send_client_reports,
        items,
      };
    });
    respond(res, reportsResponse, data);
  });

  router.post('/generate', manage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const body = generateReportsBody.parse(req.body);
    const result = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (!isClosedPeriod(body.period, now(), company.timezone)) throw notClosed();
      const clients = await eligibleClients(tx, body.period, company.timezone, body.client_ids);
      if (body.client_ids && clients.length === 0) {
        throw new HttpError(404, 'NOT_FOUND', 'Ningún cliente con plantas activas en ese mes');
      }
      const existing = await tx.monthlyReport.findMany({
        where: { period: body.period, clientId: { in: clients.map((c) => c.id) } },
      });
      const byClient = new Map(existing.map((r) => [r.clientId, r]));
      const ids: string[] = [];
      let skippedSent = 0;
      for (const c of clients) {
        const current = byClient.get(c.id);
        if (current?.status === 'sent') {
          skippedSent++;
          continue;
        }
        const row = current
          ? await tx.monthlyReport.update({
              where: { id: current.id },
              data: { status: 'pending' },
            })
          : await tx.monthlyReport.create({
              data: { companyId, clientId: c.id, period: body.period },
            });
        ids.push(row.id);
      }
      return { ids, skippedSent };
    });
    for (const id of result.ids) {
      await jobs.enqueue(reportsGenerate, { company_id: companyId, report_id: id });
    }
    respond(
      res,
      generateReportsResponse,
      { queued: result.ids.length, skipped_sent: result.skippedSent },
      202,
    );
  });

  router.get('/:id/pdf', manage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const report = await withTenant(db, companyId, (tx) =>
      tx.monthlyReport.findFirst({ where: { id }, select: { period: true, storageKey: true } }),
    );
    if (!report) throw reportNotFound();
    // La llave sale de la fila de la empresa (RLS); nunca de un parámetro.
    const pdf = report.storageKey ? await storage.get(report.storageKey) : null;
    if (!pdf) throw new HttpError(404, 'NOT_FOUND', 'El reporte aún no tiene PDF');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="Reporte-solar-${report.period}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf.body);
  });

  router.post('/:id/send', manage, async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    await withTenant(db, auth.companyId, async (tx) => {
      const report = await tx.monthlyReport.findFirst({
        where: { id },
        include: { client: { select: { reportEmail: true } } },
      });
      if (!report) throw reportNotFound();
      if (report.status === 'sent') {
        throw new HttpError(409, 'REPORT_ALREADY_SENT', 'El reporte ya se envió');
      }
      if (report.status !== 'generated') {
        throw new HttpError(409, 'REPORT_NOT_READY', 'El reporte todavía no está generado');
      }
      if (!report.client.reportEmail) {
        throw new HttpError(
          409,
          'CLIENT_NO_REPORT_EMAIL',
          'El cliente no tiene correo para reportes',
        );
      }
      await recordAudit(tx, {
        action: 'report.sent',
        companyId: auth.companyId,
        userId: auth.userId,
        entityType: 'monthly_report',
        entityId: report.id,
        metadata: { period: report.period, client_id: report.clientId },
        ip: req.ip ?? null,
      });
    });
    await jobs.enqueue(reportsSend, { company_id: auth.companyId, report_id: id });
    respond(res, sendReportResponse, { queued: true }, 202);
  });

  router.post('/send-all', manage, async (req, res) => {
    const auth = companyAuthOf(req);
    const body = sendAllBody.parse(req.body);
    const { ids, withoutEmail } = await withTenant(db, auth.companyId, async (tx) => {
      const reports = await tx.monthlyReport.findMany({
        where: { period: body.period, status: 'generated' },
        include: { client: { select: { reportEmail: true } } },
      });
      const ready = reports.filter((r) => r.client.reportEmail);
      for (const r of ready) {
        await recordAudit(tx, {
          action: 'report.sent',
          companyId: auth.companyId,
          userId: auth.userId,
          entityType: 'monthly_report',
          entityId: r.id,
          metadata: { period: r.period, client_id: r.clientId, bulk: true },
          ip: req.ip ?? null,
        });
      }
      return { ids: ready.map((r) => r.id), withoutEmail: reports.length - ready.length };
    });
    for (const id of ids) {
      await jobs.enqueue(reportsSend, { company_id: auth.companyId, report_id: id });
    }
    respond(res, sendAllResponse, { queued: ids.length, without_email: withoutEmail }, 202);
  });

  return router;
}

import { reportsGenerate, reportsMonthly, reportsMonthlyCompany, reportsSend } from '@pv/adapters';
import {
  budgetStatus,
  generateNarrative,
  queueBudgetWarning,
  recordUsage,
  templateNarrative,
} from '@pv/ai';
import {
  localDate,
  localHour,
  parseCompanySettings,
  plantInPeriod,
  renderEmail,
  shiftPeriod,
  type NotificationPayload,
} from '@pv/core';
import { listActiveCompanies, withTenant, type Prisma } from '@pv/db';
import { computeReportFacts } from '../reports/facts.js';
import { renderReportPdf } from '../reports/pdf.js';
import { loadReportLogo, storeReportPdf } from '../reports/storage.js';
import { registerJob, type JobContext } from '../runtime.js';
import { brandOf, enqueueEmails } from './notifications.js';

// Reportes mensuales (specs/08 §1): el día 1 a las 08:00 locales se crea un reporte por cliente
// con planta activa en el mes anterior; cada uno se genera (cifras → narrativa → PDF → storage)
// y se envía a mano desde la pantalla de reportes o solo, con auto_send_client_reports.

const MONTHLY_HOUR = 8;
const MAX_ERROR_LENGTH = 300;

export const reportsMonthlyJob = registerJob(reportsMonthly, async (_payload, ctx) => {
  const now = ctx.now();
  let enqueued = 0;
  for (const company of await listActiveCompanies(ctx.serviceDb)) {
    const today = localDate(now, company.timezone);
    if (today.slice(8) !== '01' || localHour(now, company.timezone) !== MONTHLY_HOUR) continue;
    const period = shiftPeriod(today.slice(0, 7), -1);
    if (await ctx.queue.enqueue(reportsMonthlyCompany, { company_id: company.id, period })) {
      enqueued++;
    }
  }
  return { enqueued };
});

/**
 * Crea (si no existen) los reportes del mes de los clientes con al menos una planta activa en él y
 * encola su generación. Un reporte que ya existe no se toca: se regenera a mano.
 */
export async function createMonthlyReports(ctx: JobContext, companyId: string, period: string) {
  const { ids, autoSend } = await withTenant(ctx.db, companyId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const clients = await tx.client.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        plants: {
          select: { status: true, commissioningDate: true, createdAt: true, deletedAt: true },
        },
      },
    });
    const eligible = clients.filter((c) =>
      c.plants.some((p) => plantInPeriod(p, period, company.timezone)),
    );
    const existing = await tx.monthlyReport.findMany({
      where: { period, clientId: { in: eligible.map((c) => c.id) } },
      select: { clientId: true },
    });
    const have = new Set(existing.map((r) => r.clientId));
    const created = await tx.monthlyReport.createManyAndReturn({
      data: eligible
        .filter((c) => !have.has(c.id))
        .map((c) => ({ companyId, clientId: c.id, period })),
      select: { id: true },
      skipDuplicates: true,
    });
    return {
      ids: created.map((r) => r.id),
      autoSend: parseCompanySettings(company.settings).notifications.auto_send_client_reports,
    };
  });
  for (const id of ids) {
    await ctx.queue.enqueue(reportsGenerate, {
      company_id: companyId,
      report_id: id,
      auto_send: autoSend,
    });
  }
  return { period, created: ids.length, auto_send: autoSend };
}

export const reportsMonthlyCompanyJob = registerJob(reportsMonthlyCompany, (payload, ctx) =>
  createMonthlyReports(ctx, payload.company_id, payload.period),
);

/** Cifras → narrativa (IA o plantilla) → PDF → storage → `generated`. */
export async function generateReport(
  ctx: JobContext,
  companyId: string,
  reportId: string,
  autoSend: boolean,
) {
  const now = ctx.now();
  // 1. Cifras y presupuesto; la IA y el PDF van fuera de la transacción.
  const loaded = await withTenant(ctx.db, companyId, async (tx) => {
    const report = await tx.monthlyReport.findFirst({
      where: { id: reportId },
      include: { client: { select: { reportEmail: true } } },
    });
    if (!report) return 'not_found' as const;
    if (report.status === 'sent') return 'already_sent' as const;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    return {
      report,
      company,
      budget: await budgetStatus(tx, company, now),
      facts: await computeReportFacts(tx, company, report.clientId, report.period),
    };
  });
  // Un reporte enviado ya no se regenera (specs/08 §1).
  if (typeof loaded === 'string') return { skipped: loaded };
  const { report, company, budget, facts } = loaded;

  try {
    // 2. Narrativa: con el presupuesto agotado, la plantilla sin llamar a la IA.
    const narrative = budget.exhausted
      ? {
          text: templateNarrative(facts, company.name),
          source: 'template' as const,
          usage: [],
          failure: 'Presupuesto mensual de IA agotado',
        }
      : await generateNarrative(ctx.ai.provider, ctx.ai.fastModel, facts, company.name);

    // 3. PDF y storage.
    const pdf = await renderReportPdf({
      facts,
      narrative: narrative.text,
      company: { name: company.name, brandColor: company.brandColor },
      logo: await loadReportLogo(ctx.storage, company),
    });
    const key = await storeReportPdf(ctx.storage, report, pdf);

    // 4. Guardar y sumar el uso de IA.
    const emails = await withTenant(ctx.db, companyId, async (tx) => {
      await tx.monthlyReport.update({
        where: { id: report.id },
        data: {
          status: 'generated',
          facts: facts as unknown as Prisma.InputJsonObject,
          narrative: narrative.text,
          narrativeSource: narrative.source,
          storageKey: key,
        },
      });
      const ids: string[] = [];
      for (const usage of narrative.usage) {
        const after = await recordUsage(tx, company, 'report_narrative', usage, now);
        if (after.crossedWarning) ids.push(...(await queueBudgetWarning(tx, company, after)));
      }
      return ids;
    });
    await enqueueEmails(ctx, companyId, emails);
    const send = autoSend && !!report.client.reportEmail;
    if (send) {
      await ctx.queue.enqueue(reportsSend, { company_id: companyId, report_id: report.id });
    }
    return {
      period: report.period,
      narrative_source: narrative.source,
      ...(narrative.failure && { failure: narrative.failure.slice(0, 200) }),
      pdf_bytes: pdf.length,
      auto_send: send,
    };
  } catch (err) {
    // Queda en `failed` hasta que un reintento (o una regeneración) lo complete.
    await withTenant(ctx.db, companyId, (tx) =>
      tx.monthlyReport.update({ where: { id: report.id }, data: { status: 'failed' } }),
    );
    throw err;
  }
}

export const reportsGenerateJob = registerJob(reportsGenerate, (payload, ctx) =>
  generateReport(ctx, payload.company_id, payload.report_id, payload.auto_send),
);

/**
 * Envía el reporte al `report_email` del cliente con el PDF adjunto. Cada envío queda en
 * `notifications` (historial y errores); al confirmarse el reporte pasa a `sent`.
 */
export async function sendReport(ctx: JobContext, companyId: string, reportId: string) {
  const loaded = await withTenant(ctx.db, companyId, async (tx) => {
    const report = await tx.monthlyReport.findFirst({
      where: { id: reportId },
      include: { client: { select: { name: true, reportEmail: true } } },
    });
    if (!report) return 'not_found' as const;
    if (report.status === 'sent') return 'already_sent' as const;
    if (report.status !== 'generated' || !report.storageKey) return 'not_generated' as const;
    const recipient = report.client.reportEmail?.trim().toLowerCase();
    if (!recipient) return 'no_report_email' as const;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const payload: NotificationPayload<'client_report'> = {
      report_id: report.id,
      period: report.period,
      client_name: report.client.name,
    };
    const email = renderEmail('client_report', payload, brandOf(company), ctx.appUrl);
    // Un reintento usa la misma fila; un envío nuevo (otro correo) crea otra.
    const notification =
      (await tx.notification.findFirst({
        where: { relatedType: 'monthly_report', relatedId: report.id, recipient },
      })) ??
      (await tx.notification.create({
        data: {
          companyId,
          recipient,
          subject: email.subject,
          template: 'client_report',
          payload,
          relatedType: 'monthly_report',
          relatedId: report.id,
        },
      }));
    return { report, recipient, email, notificationId: notification.id, key: report.storageKey };
  });
  if (typeof loaded === 'string') return { skipped: loaded };
  const { report, recipient, email, notificationId, key } = loaded;

  try {
    const pdf = await ctx.storage.get(key);
    if (!pdf) throw new Error('No se encontró el PDF del reporte');
    await ctx.email.send({
      to: recipient,
      ...email,
      attachments: [
        {
          filename: `Reporte-solar-${report.period}.pdf`,
          content: pdf.body,
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    await withTenant(ctx.db, companyId, (tx) =>
      tx.notification.update({
        where: { id: notificationId },
        data: { status: 'failed', error: `${e.name}: ${e.message}`.slice(0, MAX_ERROR_LENGTH) },
      }),
    );
    throw err;
  }
  const sentAt = ctx.now();
  await withTenant(ctx.db, companyId, async (tx) => {
    await tx.notification.update({
      where: { id: notificationId },
      data: { status: 'sent', sentAt, error: null },
    });
    await tx.monthlyReport.update({
      where: { id: report.id },
      data: { status: 'sent', sentTo: recipient, sentAt },
    });
  });
  return { period: report.period, sent: true };
}

export const reportsSendJob = registerJob(reportsSend, (payload, ctx) =>
  sendReport(ctx, payload.company_id, payload.report_id),
);

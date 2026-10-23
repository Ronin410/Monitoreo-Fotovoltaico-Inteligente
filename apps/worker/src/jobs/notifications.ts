import {
  notificationsDailySummary,
  notificationsDailySummaryCompany,
  notificationsSend,
} from '@pv/adapters';
import {
  addDays,
  localDate,
  localHour,
  parseCompanySettings,
  renderEmail,
  type EmailBrand,
  type NotificationPayload,
  type NotificationTemplate,
} from '@pv/core';
import {
  listActiveCompanies,
  withTenant,
  type Company,
  type TenantDb,
  type UserRole,
} from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';

// Correos de specs/06 §6. Quien detecta el evento guarda una fila por destinatario en
// `notifications` (en su misma transacción) y después encola notifications.send con su id.

const SUMMARY_HOUR = 7;
const MAX_ERROR_LENGTH = 300;
/** Cuántas alertas lista el resumen en "Requieren atención". */
const SUMMARY_ATTENTION_MAX = 10;

export function brandOf(company: Company): EmailBrand {
  return {
    companyName: company.name,
    brandColor: company.brandColor,
    logoUrl: company.logoUrl,
    timezone: company.timezone,
  };
}

/** alert_emails de la empresa más los usuarios activos con esos roles, sin repetir. */
export async function recipientsFor(
  tx: TenantDb,
  company: Company,
  roles: UserRole[],
): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { status: 'active', role: { in: roles } },
    select: { email: true },
  });
  const extra = parseCompanySettings(company.settings).notifications.alert_emails;
  return [...new Set([...extra, ...users.map((u) => u.email)].map((e) => e.trim().toLowerCase()))];
}

/**
 * Guarda una notificación por destinatario y devuelve sus ids para encolarlas al confirmar la
 * transacción. Un mismo evento no se notifica dos veces al mismo destinatario.
 */
export async function queueEmails<T extends NotificationTemplate>(
  tx: TenantDb,
  company: Company,
  recipients: string[],
  template: T,
  payload: NotificationPayload<T>,
  related: { type: string; id: string | null; key?: string },
): Promise<string[]> {
  if (recipients.length === 0) return [];
  const existing = await tx.notification.findMany({
    where: {
      template,
      relatedType: related.type,
      relatedId: related.id,
      ...(related.key && { payload: { path: ['key'], equals: related.key } }),
    },
    select: { recipient: true },
  });
  const already = new Set(existing.map((n) => n.recipient));
  const pending = recipients.filter((r) => !already.has(r));
  if (pending.length === 0) return [];
  const { subject } = renderEmail(template, payload, brandOf(company), '');
  const rows = await tx.notification.createManyAndReturn({
    data: pending.map((recipient) => ({
      companyId: company.id,
      recipient,
      subject,
      template,
      payload: { ...payload, ...(related.key && { key: related.key }) },
      relatedType: related.type,
      relatedId: related.id,
    })),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Encola el envío de las notificaciones ya guardadas. */
export async function enqueueEmails(ctx: JobContext, companyId: string, ids: string[]) {
  for (const id of ids) {
    await ctx.queue.enqueue(notificationsSend, { company_id: companyId, notification_id: id });
  }
}

export const notificationsSendJob = registerJob(notificationsSend, async (payload, ctx) => {
  const companyId = payload.company_id;
  const loaded = await withTenant(ctx.db, companyId, async (tx) => ({
    notification: await tx.notification.findFirst({ where: { id: payload.notification_id } }),
    company: await tx.company.findUniqueOrThrow({ where: { id: companyId } }),
  }));
  const { notification, company } = loaded;
  if (!notification) return { skipped: 'not_found' };
  if (notification.status === 'sent') return { skipped: 'already_sent' };

  const email = renderEmail(
    notification.template as NotificationTemplate,
    notification.payload,
    brandOf(company),
    ctx.appUrl,
  );
  try {
    await ctx.email.send({ to: notification.recipient, ...email });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    await withTenant(ctx.db, companyId, (tx) =>
      tx.notification.update({
        where: { id: notification.id },
        data: { status: 'failed', error: `${e.name}: ${e.message}`.slice(0, MAX_ERROR_LENGTH) },
      }),
    );
    throw err;
  }
  await withTenant(ctx.db, companyId, (tx) =>
    tx.notification.update({
      where: { id: notification.id },
      data: { status: 'sent', sentAt: ctx.now(), error: null },
    }),
  );
  return { template: notification.template };
});

export const notificationsDailySummaryJob = registerJob(
  notificationsDailySummary,
  async (_payload, ctx) => {
    const now = ctx.now();
    let enqueued = 0;
    for (const company of await listActiveCompanies(ctx.serviceDb)) {
      if (localHour(now, company.timezone) !== SUMMARY_HOUR) continue;
      const date = localDate(now, company.timezone);
      if (
        await ctx.queue.enqueue(notificationsDailySummaryCompany, { company_id: company.id, date })
      ) {
        enqueued++;
      }
    }
    return { enqueued };
  },
);

/** Arma el resumen del día `date` (07:00 locales) con lo abierto ahora y las métricas de ayer. */
export async function dailySummaryFor(ctx: JobContext, companyId: string, date: string) {
  const { ids, stats } = await withTenant(ctx.db, companyId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const [alerts, metrics] = await Promise.all([
      tx.alert.findMany({
        where: { status: { in: ['open', 'acknowledged'] }, plant: { deletedAt: null } },
        select: {
          id: true,
          type: true,
          severity: true,
          detectedAt: true,
          plant: { select: { name: true } },
        },
        orderBy: { detectedAt: 'desc' },
      }),
      tx.plantDailyMetric.findMany({
        where: {
          date: new Date(`${addDays(date, -1)}T00:00:00Z`),
          daysToCleaning: { not: null, lte: 7 },
          plant: { deletedAt: null, status: 'active' },
        },
        select: { daysToCleaning: true, plant: { select: { name: true } } },
        orderBy: { daysToCleaning: 'asc' },
      }),
    ]);
    const count = (s: 'critical' | 'warning' | 'info') =>
      alerts.filter((a) => a.severity === s).length;
    const payload: NotificationPayload<'daily_summary'> = {
      date,
      open_alerts: { critical: count('critical'), warning: count('warning'), info: count('info') },
      attention: alerts
        .filter((a) => a.severity !== 'info')
        .slice(0, SUMMARY_ATTENTION_MAX)
        .map((a) => ({
          alert_id: a.id,
          plant_name: a.plant.name,
          type: a.type,
          severity: a.severity,
        })),
      upcoming_cleanings: metrics.map((m) => ({
        plant_name: m.plant.name,
        days_to_cleaning: m.daysToCleaning as number,
      })),
      offline_plants: alerts
        .filter((a) => a.type === 'offline')
        .map((a) => ({ plant_name: a.plant.name })),
    };
    // Un resumen vacío solo es ruido (specs/PREGUNTAS.md #128).
    if (alerts.length === 0 && metrics.length === 0) {
      return { ids: [], stats: { date, skipped: 'nothing_to_report' } };
    }
    const recipients = await recipientsFor(tx, company, ['company_admin', 'operator']);
    const ids = await queueEmails(tx, company, recipients, 'daily_summary', payload, {
      type: 'daily_summary',
      id: null,
      key: date,
    });
    return { ids, stats: { date, recipients: ids.length, open_alerts: alerts.length } };
  });
  await enqueueEmails(ctx, companyId, ids);
  return stats;
}

export const notificationsDailySummaryCompanyJob = registerJob(
  notificationsDailySummaryCompany,
  (payload, ctx) => dailySummaryFor(ctx, payload.company_id, payload.date),
);

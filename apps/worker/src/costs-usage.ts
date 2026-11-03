import { companyExportStats, companyExport } from '@pv/adapters';
import type { AiUsage, CompanyUsage } from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';

// Consumo real por empresa para la hoja de costos (docs/costos.md, plan de lanzamiento 5.1).
// Solo cuenta: no lee datos de clientes. Los datos operativos se cuentan con withTenant.

const DAY_MS = 24 * 60 * 60 * 1000;

export type CostUsageOptions = {
  /** Periodo YYYY-MM del uso de IA (ai_usage_monthly). */
  period: string;
  /** Ventana de días para lecturas y correos. */
  days: number;
  /** Modelo de cada función de IA (LLM_MODEL_CHAT y LLM_MODEL_FAST). */
  models: { chat: string; fast: string };
  /** Tamaño promedio de un PDF de reporte, en KB (no se guarda el tamaño de cada uno). */
  reportPdfKb: number;
};

export type MeasuredCompany = CompanyUsage & {
  id: string;
  name: string;
  status: string;
  /** Lecturas de 15 min guardadas en la ventana, por día. */
  readingsPerDay: number;
  reports: number;
  ai: (AiUsage & { feature: string; requests: number })[];
};

/** Uso de una empresa (todas las que existan, también las suspendidas). */
export async function measureCompanyUsage(
  db: PrismaClient,
  serviceDb: PrismaClient,
  now: Date,
  options: CostUsageOptions,
): Promise<MeasuredCompany[]> {
  const since = new Date(now.getTime() - options.days * DAY_MS);
  const companies = await serviceDb.company.findMany({ orderBy: { name: 'asc' } });
  const out: MeasuredCompany[] = [];
  for (const company of companies) {
    const [plants, usage, lastExport] = await Promise.all([
      serviceDb.solarPlant.count({ where: { companyId: company.id, deletedAt: null } }),
      serviceDb.aiUsageMonthly.findMany({
        where: { companyId: company.id, period: options.period },
      }),
      serviceDb.jobRun.findFirst({
        where: { companyId: company.id, jobName: companyExport.name, status: 'succeeded' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    const counts = await withTenant(db, company.id, async (tx) => ({
      readings: await tx.telemetryReading.count({ where: { ts: { gte: since } } }),
      notifications: await tx.notification.count({
        where: { status: 'sent', sentAt: { gte: since } },
      }),
      pdfs: await tx.monthlyReport.count({ where: { storageKey: { not: null } } }),
    }));
    const exportBytes = companyExportStats.safeParse(lastExport?.stats).data?.size_bytes ?? 0;
    out.push({
      id: company.id,
      name: company.name,
      status: company.status,
      plants,
      readingsPerDay: Math.round(counts.readings / options.days),
      reports: counts.pdfs,
      // Correos enviados en la ventana (alertas, resúmenes y reportes), llevados a 30 días.
      emails: Math.round((counts.notifications * 30) / options.days),
      storageBytes: counts.pdfs * options.reportPdfKb * 1024 + exportBytes,
      ai: usage.map((u) => ({
        feature: u.feature,
        model: u.feature === 'chat' ? options.models.chat : options.models.fast,
        inputTokens: Number(u.inputTokens),
        outputTokens: Number(u.outputTokens),
        requests: u.requests,
      })),
    });
  }
  return out;
}

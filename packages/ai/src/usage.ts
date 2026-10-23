import { localDate, renderEmail } from '@pv/core';
import type { TenantDb } from '@pv/db';
import { totalInputTokens, type LLMUsage } from './provider.js';

// Uso y presupuesto mensual de IA por empresa (specs/07 §Límites y costos). Cada llamada suma sus
// tokens en ai_usage_monthly; el periodo es el mes en la zona horaria de la empresa.

export type AiFeature = 'chat' | 'alert_explanation' | 'report_narrative';

/** Umbral del aviso al company_admin. */
export const BUDGET_WARNING_RATIO = 0.8;

export const periodOf = (now: Date, timezone: string) => localDate(now, timezone).slice(0, 7);

export type BudgetStatus = {
  period: string;
  used: number;
  budget: number;
  ratio: number;
  /** Al 100 %: el chat se apaga; explicaciones y reportes usan su plantilla. */
  exhausted: boolean;
};

async function usedTokens(tx: TenantDb, period: string): Promise<number> {
  const sum = await tx.aiUsageMonthly.aggregate({
    where: { period },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return Number((sum._sum.inputTokens ?? 0n) + (sum._sum.outputTokens ?? 0n));
}

const status = (period: string, used: number, budget: number): BudgetStatus => ({
  period,
  used,
  budget,
  ratio: budget > 0 ? used / budget : 1,
  exhausted: used >= budget,
});

/** Estado del presupuesto del mes. `tx` debe ser el de la empresa (withTenant). */
export async function budgetStatus(
  tx: TenantDb,
  company: { aiMonthlyTokenBudget: number; timezone: string },
  now: Date,
): Promise<BudgetStatus> {
  const period = periodOf(now, company.timezone);
  return status(period, await usedTokens(tx, period), company.aiMonthlyTokenBudget);
}

/**
 * Suma una llamada al uso del mes. Devuelve el estado después de sumarla y si con ella se cruzó
 * el umbral del aviso (para avisar una sola vez por mes).
 */
export async function recordUsage(
  tx: TenantDb,
  company: { id: string; aiMonthlyTokenBudget: number; timezone: string },
  feature: AiFeature,
  usage: LLMUsage,
  now: Date,
): Promise<BudgetStatus & { crossedWarning: boolean }> {
  const period = periodOf(now, company.timezone);
  const before = await usedTokens(tx, period);
  const input = BigInt(totalInputTokens(usage));
  const output = BigInt(usage.outputTokens);
  await tx.aiUsageMonthly.upsert({
    where: { companyId_period_feature: { companyId: company.id, period, feature } },
    create: {
      companyId: company.id,
      period,
      feature,
      inputTokens: input,
      outputTokens: output,
      requests: 1,
    },
    update: {
      inputTokens: { increment: input },
      outputTokens: { increment: output },
      requests: { increment: 1 },
    },
  });
  const after = before + Number(input + output);
  const threshold = company.aiMonthlyTokenBudget * BUDGET_WARNING_RATIO;
  return {
    ...status(period, after, company.aiMonthlyTokenBudget),
    crossedWarning: before < threshold && after >= threshold,
  };
}

/**
 * Notificación del aviso del 80 % a los company_admin activos, una vez por mes. Devuelve los ids
 * para encolar notifications.send al confirmar la transacción.
 */
export async function queueBudgetWarning(
  tx: TenantDb,
  company: {
    id: string;
    name: string;
    brandColor: string;
    logoUrl: string | null;
    timezone: string;
  },
  status: { period: string; used: number; budget: number },
): Promise<string[]> {
  const key = `ai_budget_warning:${status.period}`;
  const admins = await tx.user.findMany({
    where: { status: 'active', role: 'company_admin' },
    select: { email: true },
  });
  const already = new Set(
    (
      await tx.notification.findMany({
        where: { template: 'ai_budget_warning', payload: { path: ['key'], equals: key } },
        select: { recipient: true },
      })
    ).map((n) => n.recipient),
  );
  const recipients = admins.map((a) => a.email.toLowerCase()).filter((e) => !already.has(e));
  if (recipients.length === 0) return [];
  const payload = {
    period: status.period,
    used_tokens: status.used,
    budget_tokens: status.budget,
  };
  const { subject } = renderEmail(
    'ai_budget_warning',
    payload,
    {
      companyName: company.name,
      brandColor: company.brandColor,
      logoUrl: company.logoUrl,
      timezone: company.timezone,
    },
    '',
  );
  const rows = await tx.notification.createManyAndReturn({
    data: recipients.map((recipient) => ({
      companyId: company.id,
      recipient,
      subject,
      template: 'ai_budget_warning',
      payload: { ...payload, key },
      relatedType: 'ai_budget',
      relatedId: null,
    })),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

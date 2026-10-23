import { aiExplainAlert } from '@pv/adapters';
import {
  budgetStatus,
  buildExplainInput,
  explainAlert,
  queueBudgetWarning,
  recordUsage,
  templateExplanation,
  type ExplainResult,
} from '@pv/ai';
import { withTenant, type Prisma } from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';
import { enqueueEmails, queueEmails, recipientsFor } from './notifications.js';

// Job ai.explain_alert (specs/07 §3): arma la entrada con cifras de nuestro código, pide la
// explicación (o usa la plantilla si se agotó el presupuesto o la IA falla), la guarda, suma los
// tokens al uso del mes y, si se pidió, manda el correo de alerta nueva con el resumen.

const OPEN_STATUSES = ['open', 'acknowledged'];

export async function explainAlertFor(
  ctx: JobContext,
  companyId: string,
  alertId: string,
  notify: boolean,
) {
  const now = ctx.now();
  // 1. Datos y presupuesto en una transacción corta; la llamada a la IA va fuera de ella.
  const loaded = await withTenant(ctx.db, companyId, async (tx) => {
    const alert = await tx.alert.findFirst({
      where: { id: alertId },
      include: {
        plant: { select: { name: true, colonia: true, client: { select: { name: true } } } },
      },
    });
    if (!alert) return null;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (alert.severity === 'info' || !OPEN_STATUSES.includes(alert.status)) {
      return { alert, company, budget: null, input: null };
    }
    return {
      alert,
      company,
      budget: await budgetStatus(tx, company, now),
      input: await buildExplainInput(tx, alert, company.timezone, now),
    };
  });
  if (!loaded) return { skipped: 'not_found' };
  const { alert, company, budget, input } = loaded;
  // Los avisos info no llevan explicación y las alertas cerradas ya no se explican.
  if (!input || !budget) return { skipped: alert.severity === 'info' ? 'info' : 'closed' };

  // 2. Explicación: con presupuesto agotado, la plantilla sin llamar a la IA.
  const result: ExplainResult = budget.exhausted
    ? {
        explanation: {
          ...templateExplanation(input),
          generated_by: 'template',
          model: null,
          generated_at: now.toISOString(),
        },
        usage: [],
        failure: 'Presupuesto mensual de IA agotado',
      }
    : await explainAlert(ctx.ai.provider, ctx.ai.fastModel, input, now);
  const aiStatus = budget.exhausted ? 'skipped' : result.failure ? 'failed' : 'done';

  // 3. Guardar, sumar el uso y preparar los correos.
  const emails = await withTenant(ctx.db, companyId, async (tx) => {
    await tx.alert.update({
      where: { id: alert.id },
      data: {
        aiExplanation: result.explanation as unknown as Prisma.InputJsonObject,
        aiStatus,
      },
    });
    const ids: string[] = [];
    for (const usage of result.usage) {
      const after = await recordUsage(tx, company, 'alert_explanation', usage, now);
      if (after.crossedWarning) ids.push(...(await queueBudgetWarning(tx, company, after)));
    }
    if (notify && !ctx.suppressNotifications) {
      const recipients = await recipientsFor(tx, company, ['company_admin']);
      const evidence = input.evidence as { trigger?: { deviation_pct?: (number | null)[] } };
      ids.push(
        ...(await queueEmails(
          tx,
          company,
          recipients,
          'alert_opened',
          {
            alert_id: alert.id,
            type: alert.type,
            severity: alert.severity,
            plant_name: alert.plant.name,
            client_name: alert.plant.client.name,
            colonia: alert.plant.colonia,
            detected_at: alert.detectedAt.toISOString(),
            deviation_pct: evidence.trigger?.deviation_pct?.at(-1) ?? null,
            summary: result.explanation.resumen,
          },
          { type: 'alert', id: alert.id },
        )),
      );
    }
    return ids;
  });
  await enqueueEmails(ctx, companyId, emails);
  return {
    ai_status: aiStatus,
    generated_by: result.explanation.generated_by,
    ...(result.failure && { failure: result.failure.slice(0, 200) }),
    calls: result.usage.length,
    tokens: result.usage.reduce(
      (s, u) => s + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens,
      0,
    ),
    emails: emails.length,
  };
}

export const aiExplainAlertJob = registerJob(aiExplainAlert, (payload, ctx) =>
  explainAlertFor(ctx, payload.company_id, payload.alert_id, payload.notify),
);

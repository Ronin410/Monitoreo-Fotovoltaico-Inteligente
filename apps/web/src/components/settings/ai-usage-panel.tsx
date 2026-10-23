'use client';

import { AlertTriangle, OctagonAlert } from 'lucide-react';
import { Notice, Spinner } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/format';
import { AI_FEATURE_LABELS, aiUsageSchema, formatTokens } from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Uso de IA del mes (specs/09 §Configuración; specs/07: aviso al 80 % del presupuesto y, al
// 100 %, el chat se apaga hasta el mes siguiente; alertas y reportes siguen con plantilla).

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const month = (period: string, year = false) =>
  formatDate(`${period}-01`, year ? { month: 'long', year: 'numeric' } : { month: 'short' });

export function AiUsagePanel() {
  const { data, error } = useApiQuery('/company/ai-usage', aiUsageSchema);
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!data) return <Spinner />;
  const ratio = data.budget_tokens > 0 ? data.used_tokens / data.budget_tokens : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
  const bar = { ok: 'bg-[var(--viz-series-1)]', near: 'bg-amber-500', over: 'bg-red-600' }[level];

  return (
    <section className={card} aria-labelledby="ai-usage-title">
      <h2 id="ai-usage-title" className="text-base font-semibold">
        Uso de IA · {month(data.period, true)}
      </h2>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatNumber(ratio * 100, 0)} %
          </span>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {formatTokens(data.used_tokens)} de {formatTokens(data.budget_tokens)} tokens del mes
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Presupuesto de IA usado"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        >
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        {level === 'near' && (
          <p className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="size-4" /> Pasaste el 80 % del presupuesto.
            Al llegar al 100 % el asistente se pausa hasta el siguiente mes.
          </p>
        )}
        {level === 'over' && (
          <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
            <OctagonAlert aria-hidden="true" className="size-4" /> Presupuesto agotado: el asistente
            está en pausa hasta el siguiente mes. Alertas y reportes siguen con texto de plantilla.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Uso por función este mes</caption>
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Función
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Solicitudes
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Tokens
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.by_feature.map((f) => (
              <tr key={f.feature}>
                <th scope="row" className="py-2 pr-3 font-normal">
                  {AI_FEATURE_LABELS[f.feature]}
                </th>
                <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(f.requests)}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatTokens(f.input_tokens + f.output_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Meses anteriores:{' '}
        {data.history.map((h) => `${month(h.period)} ${formatTokens(h.tokens)}`).join(' · ')}
      </p>
    </section>
  );
}

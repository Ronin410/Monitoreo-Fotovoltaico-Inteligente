'use client';

import Link from 'next/link';
import { SeverityBadge } from '@/components/status';
import { Notice, Spinner } from '@/components/ui';
import { ALERT_TYPE_LABELS } from '@/lib/dashboard';
import { formatDateTime } from '@/lib/format';
import {
  ALERT_STATUS_LABELS,
  alertsPage,
  TICKET_STATUS_LABELS,
  ticketsPage,
} from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';

// Alertas y tickets de la planta (specs/09 §Detalle de planta).

export function PlantActivity({ plantId, timezone }: { plantId: string; timezone: string }) {
  const alerts = useApiQuery(`/alerts?plant_id=${plantId}&page_size=10`, alertsPage);
  const tickets = useApiQuery(`/tickets?plant_id=${plantId}&page_size=10`, ticketsPage);
  const card =
    'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section className={card}>
        <h2 className="text-base font-semibold">Alertas</h2>
        {alerts.error ? (
          <Notice tone="error">{alerts.error.message}</Notice>
        ) : !alerts.data ? (
          <Spinner />
        ) : alerts.data.data.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Sin alertas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {alerts.data.data.map((a) => (
              <li key={a.id} className="py-2">
                <Link
                  href={`/alerts/${a.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm hover:underline"
                >
                  <span className="font-medium">{ALERT_TYPE_LABELS[a.type]}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      {ALERT_STATUS_LABELS[a.status]}
                    </span>
                    <SeverityBadge severity={a.severity} />
                  </span>
                </Link>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Detectada {formatDateTime(a.detected_at, timezone)}
                </span>
                {a.ai_summary && (
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{a.ai_summary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={card}>
        <h2 className="text-base font-semibold">Tickets</h2>
        {tickets.error ? (
          <Notice tone="error">{tickets.error.message}</Notice>
        ) : !tickets.data ? (
          <Spinner />
        ) : tickets.data.data.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Sin tickets.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {tickets.data.data.map((t) => (
              <li key={t.id} className="py-2 text-sm">
                <Link
                  href={`/tickets/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 hover:underline"
                >
                  <span className="font-medium">{t.title}</span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {TICKET_STATUS_LABELS[t.status]}
                  </span>
                </Link>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {t.assigned_to ? `Asignado a ${t.assigned_to.name}` : 'Sin asignar'}
                  {t.scheduled_for && ` · programado ${t.scheduled_for}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

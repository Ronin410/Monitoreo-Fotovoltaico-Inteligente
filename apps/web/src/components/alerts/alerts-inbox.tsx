'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Filter, filterControl } from '@/components/filter';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { SeverityBadge } from '@/components/status';
import { Notice, Spinner } from '@/components/ui';
import { useCompanyTimezone } from '@/lib/auth';
import { ALERT_TYPE_LABELS } from '@/lib/dashboard';
import { formatDateTime } from '@/lib/format';
import { ALERT_STATUS_LABELS, alertsPage, type AlertSummary } from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';

// Bandeja de alertas (specs/09 §Alertas): filtros por estado, tipo, severidad y zona. Por omisión
// las abiertas (abiertas y vistas), la más reciente primero.

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: 'open', label: 'Abiertas' },
  { value: '', label: 'Todas' },
  ...Object.entries(ALERT_STATUS_LABELS).map(([value, label]) => ({
    value: `status:${value}`,
    label,
  })),
];

function TicketLink({ alert }: { alert: AlertSummary }) {
  if (!alert.ticket_id) return null;
  return (
    <Link href={`/tickets/${alert.ticket_id}`} className="text-brand-text hover:underline">
      Ver ticket
    </Link>
  );
}

export function AlertsInbox() {
  const timezone = useCompanyTimezone();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (status === 'open') params.set('open', 'true');
  else if (status.startsWith('status:')) params.set('status', status.slice('status:'.length));
  if (type) params.set('type', type);
  if (severity) params.set('severity', severity);
  if (/^\d{5}$/.test(postalCode)) params.set('postal_code', postalCode);
  const { data, error, loading } = useApiQuery(`/alerts?${params}`, alertsPage);
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Alertas"
        subtitle={data ? `${data.total} ${data.total === 1 ? 'alerta' : 'alertas'}` : undefined}
      />
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <Filter
          id="status"
          label="Estado"
          value={status}
          onChange={reset(setStatus)}
          options={STATUS_OPTIONS}
        />
        <Filter
          id="type"
          label="Tipo"
          value={type}
          onChange={reset(setType)}
          options={[
            { value: '', label: 'Todos' },
            ...Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Filter
          id="severity"
          label="Severidad"
          value={severity}
          onChange={reset(setSeverity)}
          options={[
            { value: '', label: 'Todas' },
            { value: 'critical', label: 'Crítica' },
            { value: 'warning', label: 'Advertencia' },
            { value: 'info', label: 'Aviso' },
          ]}
        />
        <label
          htmlFor="cp"
          className="flex min-w-28 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400"
        >
          Zona (código postal)
          <input
            id="cp"
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(e) => reset(setPostalCode)(e.target.value)}
            className={filterControl}
          />
        </label>
      </div>

      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">
          {status === 'open' && !type && !severity && !postalCode
            ? 'No hay alertas abiertas. Todo en orden.'
            : 'Ninguna alerta coincide con los filtros.'}
        </Notice>
      ) : data ? (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Alerta
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Planta
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Zona
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Detectada
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <Link
                          href={`/alerts/${a.id}`}
                          className="font-medium text-brand-text hover:underline"
                        >
                          {ALERT_TYPE_LABELS[a.type]}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {a.plant.name}
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {a.plant.client_name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {a.plant.colonia}
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        CP {a.plant.postal_code}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateTime(a.detected_at, timezone)}
                    </td>
                    <td className="px-4 py-3">
                      {ALERT_STATUS_LABELS[a.status]}
                      <div className="text-xs">
                        <TicketLink alert={a} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/alerts/${a.id}`}
                    className="font-medium text-brand-text hover:underline"
                  >
                    {ALERT_TYPE_LABELS[a.type]}
                  </Link>
                  <SeverityBadge severity={a.severity} />
                </div>
                <span className="text-sm">
                  {a.plant.name} · {a.plant.client_name}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {a.plant.colonia} · {formatDateTime(a.detected_at, timezone)} ·{' '}
                  {ALERT_STATUS_LABELS[a.status]}
                </span>
                <span className="text-xs">
                  <TicketLink alert={a} />
                </span>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

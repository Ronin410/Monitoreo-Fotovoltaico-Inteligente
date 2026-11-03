'use client';

import { formatDuration } from '@pv/core';
import { useState } from 'react';
import { Filter } from '@/components/filter';
import { InfoTip } from '@/components/info-tip';
import { Notice } from '@/components/ui';
import type { HelpKey } from '@/lib/help';
import { ticketStatsSchema, type TicketStats } from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';

// Tiempos de atención de los tickets resueltos (specs/PREGUNTAS.md #204): cuánto tardan en
// resolverse desde que el técnico presiona "Iniciar", cuánto esperan antes y el total.

const PERIODS = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
];

const fmt = (m: number | null) => (m === null ? '—' : formatDuration(m));

function Stat({
  label,
  help,
  value,
  detail,
}: {
  label: string;
  help: HelpKey;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
        {label}
        <InfoTip help={help} label={label} />
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-xs text-slate-600 dark:text-slate-400">{detail}</span>}
    </div>
  );
}

function Summary({ stats }: { stats: TicketStats }) {
  const s = stats;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        <Stat
          label="Tiempo de trabajo"
          help="tickets.work"
          value={fmt(s.work.avg_minutes)}
          detail={`Promedio · mediana ${fmt(s.work.median_minutes)} · ${s.work.count} con inicio registrado`}
        />
        <Stat
          label="Espera antes de iniciar"
          help="tickets.wait"
          value={fmt(s.wait.avg_minutes)}
          detail={`Promedio · mediana ${fmt(s.wait.median_minutes)}`}
        />
        <Stat
          label="Tiempo total"
          help="tickets.total"
          value={fmt(s.total.avg_minutes)}
          detail={`Promedio · mediana ${fmt(s.total.median_minutes)}`}
        />
        <Stat
          label="Resueltos"
          help="tickets.median"
          value={String(s.resolved)}
          detail={`${s.in_progress} en curso ahora`}
        />
      </div>
      {s.by_assignee.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <caption className="px-4 pt-3 text-left text-sm font-semibold">
              <span className="inline-flex items-center gap-1">
                Por responsable
                <InfoTip help="tickets.byAssignee" label="Por responsable" />
              </span>
            </caption>
            <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Responsable
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Resueltos
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Trabajo promedio
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Mediana
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.by_assignee.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{a.resolved}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(a.work.avg_minutes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmt(a.work.median_minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function TicketStatsPanel() {
  const [days, setDays] = useState('30');
  const { data, error } = useApiQuery(`/tickets/stats?days=${days}`, ticketStatsSchema);
  return (
    <section aria-labelledby="ticket-times" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="ticket-times" className="text-base font-semibold">
          Tiempos de atención
        </h2>
        <div className="flex w-full sm:w-56">
          <Filter
            id="stats-days"
            label="Periodo"
            value={days}
            onChange={setDays}
            options={PERIODS}
          />
        </div>
      </div>
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : data && data.resolved === 0 ? (
        <Notice tone="info">
          Sin tickets resueltos en el periodo. El tiempo se mide desde que el técnico presiona
          &quot;Iniciar&quot; hasta que lo resuelve.
        </Notice>
      ) : data ? (
        <Summary stats={data} />
      ) : null}
    </section>
  );
}

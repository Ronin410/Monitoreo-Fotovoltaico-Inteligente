'use client';

import { Bot, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent, ReactNode } from 'react';
import { SeverityBadge, STATUS, StatusBadge } from '@/components/status';
import { Button, Notice } from '@/components/ui';
import { ALERT_TYPE_LABELS, type PlantStatus } from '@/lib/dashboard';
import { formatDate, formatDateTime, formatEnergy, formatNumber, formatPct } from '@/lib/format';
import { useDashboard, type DashboardData } from './use-dashboard';

const FleetMap = dynamic(() => import('@/components/fleet-map'), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
});

const CONFIDENCE = {
  low: 'Confianza baja',
  medium: 'Confianza media',
  high: 'Confianza alta',
} as const;
const ATTENTION_MAX = 5;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {value}
        {unit && (
          <span className="ml-1 text-base font-medium text-slate-500 dark:text-slate-400">
            {unit}
          </span>
        )}
      </span>
      {detail && <div className="text-xs text-slate-600 dark:text-slate-400">{detail}</div>}
    </div>
  );
}

function QuickAsk() {
  const router = useRouter();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (q) router.push(`/assistant?q=${encodeURIComponent(q)}`);
  }
  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-xl gap-2" role="search">
      <label htmlFor="pregunta" className="sr-only">
        Pregúntale a tu flota
      </label>
      <div className="relative min-w-0 flex-1">
        <Bot
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-slate-400"
        />
        <input
          id="pregunta"
          name="q"
          maxLength={2000}
          placeholder="Pregúntale a tu flota… ¿qué plantas lavo esta semana?"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-10 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
      </div>
      <Button type="submit">Preguntar</Button>
    </form>
  );
}

function Legend({ counts }: { counts: Record<PlantStatus, number> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
      {(Object.keys(STATUS) as PlantStatus[])
        .filter((s) => counts[s] > 0)
        .map((s) => (
          <li key={s}>
            <StatusBadge status={s} /> <span className="tabular-nums">{counts[s]}</span>
          </li>
        ))}
    </ul>
  );
}

function Ranking({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: DashboardData['ranking']['best'];
  tone: 'good' | 'bad';
}) {
  const color = tone === 'good' ? 'bg-green-600' : 'bg-amber-500';
  return (
    <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2">
      <h3
        className={`text-xs font-semibold tracking-wide uppercase ${tone === 'good' ? 'text-green-700 dark:text-green-400' : 'text-amber-800 dark:text-amber-400'}`}
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Sin suficientes días válidos.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2 text-sm">
                <Link href={`/plants/${r.id}`} className="truncate hover:underline">
                  {r.name}
                </Link>
                <span className="font-medium tabular-nums">{formatPct(r.pr_temp_avg)}</span>
              </div>
              {/* Barra de 60 % a 95 % de PR corregido. */}
              <div aria-hidden="true" className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-1.5 rounded-full ${color}`}
                  style={{
                    width: `${Math.max(4, Math.min(100, ((r.pr_temp_avg - 0.6) / 0.35) * 100))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const { summary, map, cleanings, ranking, attention } = data;
  const today = formatEnergy(summary.energy_today_kwh);
  const month = formatEnergy(summary.energy_month_kwh);
  const counts = { ok: 0, warning: 0, critical: 0, offline: 0, no_data: 0 } as Record<
    PlantStatus,
    number
  >;
  for (const p of map.plants) counts[p.status]++;
  const urgent = attention.data.filter((a) => a.severity !== 'info').slice(0, ATTENTION_MAX);
  const { critical, warning, info } = summary.alerts_open;

  if (summary.plants.active === 0) {
    return (
      <Notice tone="info">
        Aún no hay plantas activas.{' '}
        <Link href="/plants" className="font-semibold underline">
          Da de alta tu primera planta
        </Link>{' '}
        para ver aquí su rendimiento.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Resumen"
        className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
      >
        <Kpi
          label="Plantas activas"
          value={formatNumber(summary.plants.active)}
          detail={`${formatNumber(summary.plants.capacity_kwp, 1)} kWp · ${formatNumber(summary.plants.clients)} clientes`}
        />
        <Kpi
          label="Energía de hoy"
          value={today.value}
          unit={today.unit}
          detail="Hasta la última lectura"
        />
        <Kpi
          label="Energía del mes"
          value={month.value}
          unit={month.unit}
          detail={`Desde el 1 de ${formatDate(summary.date, { month: 'long' })}`}
        />
        <Kpi
          label="PR corregido · 7 días"
          value={summary.pr_temp_7d === null ? '—' : formatNumber(summary.pr_temp_7d * 100, 1)}
          unit={summary.pr_temp_7d === null ? undefined : '%'}
          detail="Promedio de días válidos"
        />
        <Kpi
          label="Alertas abiertas"
          value={formatNumber(critical + warning + info)}
          detail={
            <span className="flex flex-wrap gap-1">
              <span>{plural(critical, 'crítica', 'críticas')}</span>·
              <span>{plural(warning, 'advertencia', 'advertencias')}</span>·
              <span>{plural(info, 'aviso', 'avisos')}</span>
              {summary.offline_plants > 0 && (
                <span className="w-full">{summary.offline_plants} sin datos</span>
              )}
            </span>
          }
        />
      </section>

      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[999_1_560px]">
          <Card title="Mapa de plantas" action={<Legend counts={counts} />}>
            <div
              className="h-[420px]"
              role="region"
              aria-label={`Mapa con ${map.plants.length} plantas`}
            >
              <FleetMap plants={map.plants} />
            </div>
          </Card>
        </div>
        <div className="min-w-0 flex-[1_1_320px]">
          <Card
            title="Requieren atención"
            action={
              <Link href="/alerts" className="text-sm font-medium text-brand-text hover:underline">
                Ver alertas
              </Link>
            }
          >
            {urgent.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No hay alertas críticas ni de advertencia abiertas.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {urgent.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/alerts/${a.id}`}
                      className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{a.plant.name}</span>
                        <SeverityBadge severity={a.severity} />
                      </span>
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        {ALERT_TYPE_LABELS[a.type]}
                      </span>
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {a.plant.client_name} · detectada{' '}
                        {formatDateTime(a.detected_at, summary.timezone)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1_1_360px]">
          <Card title="Próximos lavados">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Plantas que cruzarán el umbral de suciedad en los próximos {cleanings.days} días.
            </p>
            {cleanings.plants.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Ninguna por ahora.</p>
            ) : (
              <ul className="flex flex-col">
                {cleanings.plants.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-4 border-t border-slate-100 py-3 dark:border-slate-800"
                  >
                    <span className="flex w-14 shrink-0 flex-col items-center">
                      <span
                        className={`text-2xl leading-none font-bold tabular-nums ${c.days_to_cleaning <= 2 ? 'text-amber-700 dark:text-amber-400' : ''}`}
                      >
                        {c.days_to_cleaning === 0 ? 'Ya' : c.days_to_cleaning}
                      </span>
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {c.days_to_cleaning === 0
                          ? 'lavar'
                          : c.days_to_cleaning === 1
                            ? 'día'
                            : 'días'}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Link
                        href={`/plants/${c.id}`}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {c.name}
                      </Link>
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {c.client_name}
                        {c.deviation_pct !== null &&
                          ` · ${formatNumber(c.deviation_pct, 1)} % bajo su normal`}
                        {/* En el celular la confianza va aquí para no recortar el nombre. */}
                        {c.confidence && (
                          <span className="block sm:hidden">{CONFIDENCE[c.confidence]}</span>
                        )}
                      </span>
                    </span>
                    {c.confidence && (
                      <span className="hidden text-xs whitespace-nowrap text-slate-700 sm:inline dark:text-slate-300">
                        {CONFIDENCE[c.confidence]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0 flex-[2_1_520px]">
          <Card title={`Mejores y peores · PR corregido de ${ranking.days} días`}>
            <div className="flex flex-wrap gap-6">
              <Ranking title="Mejores 5" rows={ranking.best} tone="good" />
              <Ranking title="Peores 5" rows={ranking.worst} tone="bad" />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Solo plantas con al menos {ranking.min_valid_days} días válidos en el periodo.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando el tablero" className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="h-[480px] animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

export function DashboardView() {
  const { data, error, reload } = useDashboard();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Tablero de flota</h1>
          {data && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {formatDate(data.summary.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          )}
        </div>
        <QuickAsk />
      </div>
      {error ? (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="error">No se pudo cargar el tablero: {error}</Notice>
          <Button variant="secondary" onClick={() => void reload()}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Reintentar
          </Button>
        </div>
      ) : data ? (
        <Dashboard data={data} />
      ) : (
        <Skeleton />
      )}
    </div>
  );
}

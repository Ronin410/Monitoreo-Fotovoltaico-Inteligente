'use client';

import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Notice, Spinner } from '@/components/ui';
import { addDaysIso, formatDate, formatNumber } from '@/lib/format';
import { dailyMetricsResponse, EVENT_LABELS, type DailyMetrics } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';
import { ChartCard, ChartLegend, tableClass } from './chart-card';

// Rendimiento diario, predicción de lavado y comparación con vecinas (specs/09 §Detalle).

const RANGES = [30, 90, 365] as const;
const axis = { fill: 'var(--viz-axis)', fontSize: 12 };
const tooltipStyle = {
  background: 'var(--viz-surface)',
  border: '1px solid var(--viz-grid)',
  borderRadius: 8,
  fontSize: 12,
};
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${formatNumber(v * 100, 1)} %`;

function RangeSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: (typeof RANGES)[number]) => void;
}) {
  return (
    <fieldset className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
      <legend className="sr-only">Periodo</legend>
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          className={`min-h-9 rounded-md px-3 text-sm ${value === r ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-600 dark:text-slate-400'}`}
        >
          {r === 365 ? '1 año' : `${r} días`}
        </button>
      ))}
    </fieldset>
  );
}

function PerformanceChart({
  data,
  range,
  setRange,
}: {
  data: DailyMetrics;
  range: number;
  setRange: (r: (typeof RANGES)[number]) => void;
}) {
  const threshold = 1 - data.soiling_deviation_pct / 100;
  const points = data.days.map((d) => ({
    date: d.date,
    label: formatDate(d.date),
    pr: d.is_valid_day ? d.pr_temp : null,
    baseline: d.pr_baseline,
    threshold: d.pr_baseline === null ? null : d.pr_baseline * threshold,
  }));
  const resets = data.events.filter((e) => points.some((p) => p.date === e.date));
  return (
    <ChartCard
      title="Rendimiento diario (PR corregido)"
      description={`Solo días válidos. Si la línea azul baja del umbral (${formatNumber(data.soiling_deviation_pct, 0)} % bajo su normal) conviene revisar o lavar.`}
      controls={<RangeSelector value={range} onChange={setRange} />}
      table={
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">PR corregido</th>
              <th scope="col">Línea base</th>
              <th scope="col">Desviación</th>
              <th scope="col">Lluvia</th>
              <th scope="col">Día válido</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((d) => (
              <tr key={d.date}>
                <td>{formatDate(d.date)}</td>
                <td>{pct(d.pr_temp)}</td>
                <td>{pct(d.pr_baseline)}</td>
                <td>{d.deviation_pct === null ? '—' : `${formatNumber(d.deviation_pct, 1)} %`}</td>
                <td>{d.rain_mm > 0 ? `${formatNumber(d.rain_mm, 1)} mm` : '—'}</td>
                <td>{d.is_valid_day ? 'Sí' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {points.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Aún no hay días calculados en este periodo.
        </p>
      ) : (
        <>
          <ChartLegend
            items={[
              { label: 'PR corregido', color: 'var(--viz-series-1)' },
              { label: 'Su normal (línea base)', color: 'var(--viz-reference)', dashed: true },
              { label: 'Umbral de suciedad', color: 'var(--viz-threshold)', dashed: true },
            ]}
          />
          <div
            className="h-72"
            role="img"
            aria-label="Gráfica del PR corregido diario con su línea base y el umbral de suciedad; los datos están en la tabla"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 16, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={axis}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tick={axis}
                  tickLine={false}
                  axisLine={false}
                  domain={[0.5, 1]}
                  ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                  width={48}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [
                    pct(v as number | null),
                    name === 'pr' ? 'PR corregido' : name === 'baseline' ? 'Línea base' : 'Umbral',
                  ]}
                />
                {resets.map((e) => (
                  <ReferenceLine
                    key={`${e.type}-${e.date}`}
                    x={formatDate(e.date)}
                    stroke="var(--viz-reference)"
                    strokeOpacity={0.6}
                    label={{
                      value: e.type === 'rain_cleaning' ? '☂' : '✦',
                      position: 'top',
                      fill: 'var(--viz-axis)',
                      fontSize: 12,
                    }}
                  />
                ))}
                <Line
                  dataKey="baseline"
                  stroke="var(--viz-reference)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="threshold"
                  stroke="var(--viz-threshold)"
                  strokeWidth={2}
                  strokeDasharray="2 3"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="pr"
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {resets.length > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Marcas: ☂ lavado por lluvia · ✦ limpieza o reparación.{' '}
              {resets
                .map(
                  (e) =>
                    `${EVENT_LABELS[e.type as keyof typeof EVENT_LABELS] ?? e.type} el ${formatDate(e.date)}`,
                )
                .join(' · ')}
              .
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}

function CleaningPrediction({ data }: { data: DailyMetrics }) {
  const last = [...data.days]
    .reverse()
    .find((d) => d.days_to_cleaning !== null || d.soiling_slope_pct_per_day !== null);
  const lastReset = [...data.events].reverse()[0];
  return (
    <ChartCard title="Predicción de lavado">
      {!last ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Aún no hay suficientes días válidos desde el último lavado o lluvia para estimar una
          tendencia (se necesitan 7).
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Días para lavar</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {last.days_to_cleaning === null
                ? 'Sin tendencia'
                : last.days_to_cleaning === 0
                  ? 'Ya'
                  : last.days_to_cleaning}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Tendencia</dt>
            <dd className="tabular-nums">
              {last.soiling_slope_pct_per_day === null
                ? '—'
                : `${formatNumber(last.soiling_slope_pct_per_day, 2)} % por día`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Calculado</dt>
            <dd>{formatDate(last.date, { day: 'numeric', month: 'long' })}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Último reinicio</dt>
            <dd>
              {lastReset
                ? `${EVENT_LABELS[lastReset.type as keyof typeof EVENT_LABELS] ?? lastReset.type}, ${formatDate(lastReset.date)}`
                : 'Sin lavados ni lluvias en el periodo'}
            </dd>
          </div>
        </dl>
      )}
    </ChartCard>
  );
}

function NeighborsChart({ data }: { data: DailyMetrics }) {
  const points = data.days.map((d) => ({
    label: formatDate(d.date),
    index: d.neighbor_index,
    count: d.neighbor_count,
  }));
  const withData = points.filter((p) => p.index !== null);
  return (
    <ChartCard
      title="Comparación con vecinas"
      description="1.0 = rinde igual que las plantas cercanas de tu empresa; abajo de 0.8 rinde claramente menos."
      table={
        withData.length > 0 && (
          <table className={tableClass}>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Índice</th>
                <th scope="col">Vecinas</th>
              </tr>
            </thead>
            <tbody>
              {withData.map((p) => (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td>{formatNumber(p.index as number, 2)}</td>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    >
      {withData.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sin suficientes plantas vecinas con datos en el periodo.
        </p>
      ) : (
        <div
          className="h-56"
          role="img"
          aria-label="Gráfica del índice frente a vecinas; los datos están en la tabla"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={axis}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={axis}
                tickLine={false}
                axisLine={false}
                domain={[0.6, 1.2]}
                ticks={[0.6, 0.8, 1, 1.2]}
                width={40}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [
                  v === null || v === undefined ? '—' : formatNumber(Number(v), 2),
                  'Índice',
                ]}
              />
              <ReferenceLine y={1} stroke="var(--viz-reference)" strokeDasharray="5 4" />
              <ReferenceLine y={0.8} stroke="var(--viz-threshold)" strokeDasharray="2 3" />
              <Line
                dataKey="index"
                stroke="var(--viz-series-1)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/** Hoy en la zona de la empresa (YYYY-MM-DD). */
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

export function PerformanceCharts({ plantId, timezone }: { plantId: string; timezone: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [to] = useState(() => addDaysIso(todayIn(timezone), -1));
  const from = addDaysIso(to, -(range - 1));
  // Las vecinas y la predicción usan siempre los últimos 30 días.
  const main = useApiQuery(
    `/plants/${plantId}/daily-metrics?from=${from}&to=${to}`,
    dailyMetricsResponse,
  );
  const recent = useApiQuery(`/plants/${plantId}/daily-metrics`, dailyMetricsResponse);
  if (main.error) return <Notice tone="error">{main.error.message}</Notice>;
  return (
    <div className="flex flex-col gap-5">
      {main.data ? (
        <PerformanceChart data={main.data} range={range} setRange={setRange} />
      ) : (
        <Spinner />
      )}
      {recent.data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CleaningPrediction data={recent.data} />
          <NeighborsChart data={recent.data} />
        </div>
      )}
    </div>
  );
}

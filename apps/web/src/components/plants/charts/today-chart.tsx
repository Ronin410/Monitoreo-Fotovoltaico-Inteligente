'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Notice, Spinner } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { todayResponse } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';
import { ChartCard, ChartLegend, tableClass } from './chart-card';

// Hoy: potencia real contra la esperada con el clima (specs/09). Un solo eje (kW).

const hourOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export function TodayChart({ plantId }: { plantId: string }) {
  const { data, error } = useApiQuery(`/plants/${plantId}/today`, todayResponse);
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!data) return <Spinner />;
  // Solo las horas con sol (esperada > 0 o lectura).
  const points = data.intervals
    .filter((i) => (i.expected_kw ?? 0) > 0 || i.power_kw !== null)
    .map((i) => ({ hour: hourOf(i.ts, data.timezone), real: i.power_kw, expected: i.expected_kw }));
  const hasReal = points.some((p) => p.real !== null);

  return (
    <ChartCard
      title="Hoy: potencia real y esperada"
      description={`La esperada sale del clima de la hora y del rendimiento normal de la planta (PR ${formatNumber(data.baseline_pr * 100, 1)} %).`}
      table={
        points.length > 0 && (
          <table className={tableClass}>
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Real (kW)</th>
                <th scope="col">Esperada (kW)</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.hour}>
                  <td>{p.hour}</td>
                  <td>{p.real === null ? '—' : formatNumber(p.real, 2)}</td>
                  <td>{p.expected === null ? '—' : formatNumber(p.expected, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    >
      {points.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Aún no hay clima ni lecturas de hoy.
        </p>
      ) : (
        <>
          <ChartLegend
            items={[
              { label: 'Real', color: 'var(--viz-series-1)' },
              { label: 'Esperada', color: 'var(--viz-reference)', dashed: true },
            ]}
          />
          {!hasReal && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Sin lecturas del inversor hoy.
            </p>
          )}
          <div
            className="h-64"
            role="img"
            aria-label="Gráfica de potencia real y esperada de hoy; los datos están en la tabla"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: 'var(--viz-axis)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: 'var(--viz-axis)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  unit=" kW"
                  width={64}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--viz-surface)',
                    border: '1px solid var(--viz-grid)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v, name) => [
                    v === null || v === undefined ? '—' : `${formatNumber(Number(v), 2)} kW`,
                    name === 'real' ? 'Real' : 'Esperada',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="expected"
                  stroke="var(--viz-reference)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartCard>
  );
}

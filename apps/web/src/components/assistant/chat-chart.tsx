'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard, ChartLegend, tableClass } from '@/components/plants/charts/chart-card';
import type { ChartSpec } from '@/lib/assistant';
import { formatNumber } from '@/lib/format';

// Gráficas que pide el asistente con render_chart (specs/07 §2). Un solo eje; colores
// categóricos validados en orden fijo (nunca reciclados); leyenda y tabla con los mismos datos.

const COLORS = [
  'var(--viz-series-1)',
  'var(--viz-series-2)',
  'var(--viz-series-3)',
  'var(--viz-series-4)',
];
const axis = { fill: 'var(--viz-axis)', fontSize: 12 };
const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : formatNumber(v, Math.abs(v) < 10 ? 2 : 1);

export function ChatChart({ chart }: { chart: ChartSpec }) {
  const xs: (string | number)[] = [];
  for (const s of chart.series) for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  const rows: ({ x: string } & Record<string, string | number | null>)[] = xs.map((x) => ({
    x: String(x),
    ...Object.fromEntries(
      chart.series.map((s, i) => [`s${i}`, s.points.find((p) => p.x === x)?.y ?? null]),
    ),
  }));
  const series = chart.series.slice(0, COLORS.length);
  const label = `Gráfica de ${chart.type === 'bar' ? 'barras' : 'línea'}: ${chart.title}; los datos están en la tabla`;
  const common = (
    <>
      <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
      <XAxis dataKey="x" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
      <YAxis
        tick={axis}
        tickLine={false}
        axisLine={false}
        width={52}
        tickFormatter={(v: number) => fmt(v)}
      />
      <Tooltip
        contentStyle={{
          background: 'var(--viz-surface)',
          border: '1px solid var(--viz-grid)',
          borderRadius: 8,
          fontSize: 12,
        }}
        formatter={(v, key) => [
          fmt(v as number | null),
          series[Number(String(key).slice(1))]?.name ?? '',
        ]}
      />
    </>
  );
  return (
    <ChartCard
      title={chart.title}
      description={[chart.y_label, chart.x_label && `por ${chart.x_label}`]
        .filter(Boolean)
        .join(' ')}
      table={
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col">{chart.x_label || 'Dato'}</th>
              {series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.x}>
                <td>{r.x}</td>
                {series.map((s, i) => (
                  <td key={s.name}>{fmt(r[`s${i}`] as number | null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {series.length > 1 && (
        <ChartLegend
          items={series.map((s, i) => ({
            label: s.name,
            color: COLORS[i] ?? 'var(--viz-series-1)',
          }))}
        />
      )}
      <div className="h-64" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === 'bar' ? (
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              {common}
              {series.map((s, i) => (
                <Bar
                  key={s.name}
                  dataKey={`s${i}`}
                  fill={COLORS[i]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              {common}
              {series.map((s, i) => (
                <Line
                  key={s.name}
                  dataKey={`s${i}`}
                  stroke={COLORS[i]}
                  strokeWidth={2}
                  dot={rows.length <= 40 ? { r: 3 } : false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

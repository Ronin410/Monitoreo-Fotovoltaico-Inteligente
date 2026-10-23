'use client';

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
import { ChartCard, ChartLegend, tableClass } from '@/components/plants/charts/chart-card';
import { formatDate, formatNumber } from '@/lib/format';
import { evidenceSchema } from '@/lib/operations';

// Evidencia de la alerta (specs/06 §3): PR corregido de los últimos 14 días contra su normal.
// Un solo eje (PR); la desviación, las vecinas y la lluvia van en la tabla.

const axis = { fill: 'var(--viz-axis)', fontSize: 12 };
const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : `${formatNumber(v * 100, digits)} %`;

export function EvidenceChart({ evidence }: { evidence: unknown }) {
  const parsed = evidenceSchema.safeParse(evidence);
  const days = parsed.success ? (parsed.data.last_14_days ?? []) : [];
  if (days.length === 0) return null;
  const baseline = parsed.data?.baseline?.value ?? null;
  const triggers = new Set(parsed.data?.trigger?.dates ?? []);
  const points = days.map((d) => ({
    label: formatDate(d.date),
    pr: d.valid ? d.pr_temp : null,
  }));
  const values = points.flatMap((p) => (p.pr === null ? [] : [p.pr]));
  if (baseline !== null) values.push(baseline);
  const low = values.length ? Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10) : 0.5;

  return (
    <ChartCard
      title="Evidencia: últimos 14 días"
      description="PR corregido de cada día válido contra su normal. Los días marcados en la tabla son los que dispararon la alerta."
      table={
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">PR corregido</th>
              <th scope="col">Desviación</th>
              <th scope="col">Frente a vecinas</th>
              <th scope="col">Lluvia</th>
              <th scope="col">Día válido</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className={triggers.has(d.date) ? 'font-semibold' : undefined}>
                <td>
                  {formatDate(d.date)}
                  {triggers.has(d.date) ? ' · disparó' : ''}
                </td>
                <td>{pct(d.pr_temp)}</td>
                <td>{d.deviation_pct === null ? '—' : `${formatNumber(d.deviation_pct, 1)} %`}</td>
                <td>{pct(d.neighbor_index, 0)}</td>
                <td>{d.rain_mm ? `${formatNumber(d.rain_mm, 1)} mm` : '—'}</td>
                <td>{d.valid ? 'Sí' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ChartLegend
        items={[
          { label: 'PR corregido', color: 'var(--viz-series-1)' },
          ...(baseline === null
            ? []
            : [{ label: 'Su normal (línea base)', color: 'var(--viz-reference)', dashed: true }]),
        ]}
      />
      <div
        className="h-64"
        role="img"
        aria-label="Gráfica del PR corregido de los últimos 14 días contra su normal; los datos están en la tabla"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tick={axis}
              tickLine={false}
              axisLine={false}
              domain={[low, 1]}
              ticks={Array.from({ length: Math.round((1 - low) * 10) + 1 }, (_, i) => low + i / 10)}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--viz-surface)',
                border: '1px solid var(--viz-grid)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => [pct(v as number | null), 'PR corregido']}
            />
            {baseline !== null && (
              <ReferenceLine
                y={baseline}
                stroke="var(--viz-reference)"
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            )}
            <Line
              dataKey="pr"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

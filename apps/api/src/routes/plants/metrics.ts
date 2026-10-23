import {
  addDays,
  currentPlantStatus,
  localDate,
  startOfLocalDay,
  type DailyStatus,
} from '@pv/core';
import type { TenantDb } from '@pv/db';
import { dec } from '../../http/decimal.js';

// Métricas de la lista y el detalle de plantas (specs/09 §Plantas): estado actual, energía de
// hoy, PR corregido de 7 días y la predicción de lavado del último día calculado. Se calculan
// en lote (unas pocas consultas para toda la página, no una por planta).

const OPEN = ['open', 'acknowledged'] as const;
/** El último día calculado vale si es de los 2 días anteriores (o de hoy). */
const RECENT_DAYS = 2;

export type PlantMetrics = {
  status: DailyStatus;
  energy_today_kwh: number;
  pr_temp_7d: number | null;
  deviation_pct: number | null;
  days_to_cleaning: number | null;
  prediction_confidence: 'low' | 'medium' | 'high' | null;
  last_metric_date: string | null;
};

const day = (d: string) => new Date(`${d}T00:00:00Z`);

export async function plantMetrics(
  tx: TenantDb,
  plantIds: string[],
  timezone: string,
  now: Date,
): Promise<Map<string, PlantMetrics>> {
  const out = new Map<string, PlantMetrics>();
  if (plantIds.length === 0) return out;
  const today = localDate(now, timezone);
  const where = { plantId: { in: plantIds } };
  const [energy, pr, recent, alerts] = await Promise.all([
    tx.telemetryReading.groupBy({
      by: ['plantId'],
      where: { ...where, ts: { gte: startOfLocalDay(today, timezone) } },
      _sum: { energyKwh: true },
    }),
    tx.plantDailyMetric.groupBy({
      by: ['plantId'],
      where: {
        ...where,
        isValidDay: true,
        date: { gte: day(addDays(today, -7)), lt: day(today) },
      },
      _avg: { prTemp: true },
    }),
    tx.plantDailyMetric.findMany({
      where: { ...where, date: { gte: day(addDays(today, -RECENT_DAYS)) } },
      orderBy: { date: 'desc' },
      select: {
        plantId: true,
        date: true,
        status: true,
        deviationPct: true,
        daysToCleaning: true,
        predictionConfidence: true,
      },
    }),
    tx.alert.findMany({
      where: { ...where, status: { in: [...OPEN] } },
      select: { plantId: true, type: true, severity: true },
    }),
  ]);
  for (const id of plantIds) {
    const last = recent.find((m) => m.plantId === id);
    out.set(id, {
      status: currentPlantStatus({
        openAlerts: alerts.filter((a) => a.plantId === id),
        lastDailyStatus: last?.status ?? null,
      }),
      energy_today_kwh: dec(energy.find((e) => e.plantId === id)?._sum.energyKwh ?? null) ?? 0,
      pr_temp_7d: dec(pr.find((p) => p.plantId === id)?._avg.prTemp ?? null),
      deviation_pct: dec(last?.deviationPct ?? null),
      days_to_cleaning: last?.daysToCleaning ?? null,
      prediction_confidence: last?.predictionConfidence ?? null,
      last_metric_date: last ? last.date.toISOString().slice(0, 10) : null,
    });
  }
  return out;
}

export const METRIC_SORTS = [
  'pr_7d',
  '-pr_7d',
  'deviation',
  '-deviation',
  'days_to_cleaning',
] as const;
export type MetricSort = (typeof METRIC_SORTS)[number];

/** Orden por métrica; los que no tienen el dato van al final. */
export function compareByMetric(sort: MetricSort, a: PlantMetrics, b: PlantMetrics): number {
  const value = (m: PlantMetrics) =>
    sort.endsWith('pr_7d')
      ? m.pr_temp_7d
      : sort.endsWith('deviation')
        ? m.deviation_pct
        : m.days_to_cleaning;
  const va = value(a);
  const vb = value(b);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return sort.startsWith('-') ? vb - va : va - vb;
}

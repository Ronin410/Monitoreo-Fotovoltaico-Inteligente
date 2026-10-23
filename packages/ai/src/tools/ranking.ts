import { z } from 'zod';
import {
  aggregateByPlant,
  dateOf,
  latestPrediction,
  limitSchema,
  periodSchema,
  plantWhere,
  r1,
  r3,
  resolvePeriod,
  zoneSchema,
  type PlantAggregate,
  type ResolvedPeriod,
  type ToolContext,
  type Zone,
} from './context.js';
import { defineTool } from './tool.js';

// Rankings, zonas y comparación de periodos (specs/07 §2). El PR de un grupo es Σ energía / Σ
// esperada de sus días válidos, que pondera por tamaño.

async function plantsIn(ctx: ToolContext, zone: Zone | undefined) {
  return ctx.tx.solarPlant.findMany({
    where: plantWhere(zone),
    select: {
      id: true,
      name: true,
      colonia: true,
      postalCode: true,
      capacityKwp: true,
      client: { select: { name: true, city: true } },
    },
  });
}
type ZonePlant = Awaited<ReturnType<typeof plantsIn>>[number];

const RANK_METRICS = [
  'pr_temp',
  'specific_yield',
  'energy_kwh',
  'deviation_avg',
  'neighbor_index_avg',
  'availability_pct',
  'days_to_cleaning',
] as const;

function metricValue(
  metric: (typeof RANK_METRICS)[number],
  a: PlantAggregate,
  kwp: number,
  period: ResolvedPeriod,
  daysToCleaning: number | null,
): number | null {
  switch (metric) {
    case 'pr_temp':
      return r3(a.pr_temp);
    case 'specific_yield':
      return a.days_with_data ? r1(a.energy_kwh / kwp) : null;
    case 'energy_kwh':
      return a.days_with_data ? r1(a.energy_kwh) : null;
    case 'deviation_avg':
      return r1(a.deviation_avg);
    case 'neighbor_index_avg':
      return r3(a.neighbor_index_avg);
    case 'availability_pct':
      // Días con datos (no offline) entre los días del periodo.
      return a.days_with_data
        ? r1(((a.days_with_data - a.offline_days) / period.days) * 100)
        : null;
    case 'days_to_cleaning':
      return daysToCleaning;
  }
}

export const rankPlants = defineTool({
  name: 'rank_plants',
  description:
    'Ordena plantas por una métrica en un periodo. pr_temp: PR corregido; specific_yield: kWh por kWp; energy_kwh; deviation_avg: % promedio bajo su normal; neighbor_index_avg: frente a vecinas (1 = igual); availability_pct: % de días con datos; days_to_cleaning: días estimados para el lavado. Devuelve el valor y los días válidos usados. Plantas sin dato quedan fuera.',
  input: z
    .object({
      metric: z.enum(RANK_METRICS),
      period: periodSchema,
      order: z.enum(['asc', 'desc']).describe('asc = de menor a mayor'),
      limit: limitSchema(10),
      zone: zoneSchema.optional(),
    })
    .strict(),
  run: async ({ metric, period, order, limit, zone }, ctx) => {
    const p = resolvePeriod(period, ctx.today);
    const plants = await plantsIn(ctx, zone);
    const ids = plants.map((x) => x.id);
    const [agg, latest] = await Promise.all([
      aggregateByPlant(ctx, ids, p),
      metric === 'days_to_cleaning' ? latestPrediction(ctx, ids) : Promise.resolve(new Map()),
    ]);
    const rows = plants.flatMap((x) => {
      const a = agg.get(x.id);
      if (!a) return [];
      const value = metricValue(
        metric,
        a,
        x.capacityKwp.toNumber(),
        p,
        latest.get(x.id)?.daysToCleaning ?? null,
      );
      if (value === null) return [];
      return [
        {
          plant_id: x.id,
          name: x.name,
          client: x.client.name,
          colonia: x.colonia,
          value,
          valid_days: a.valid_days,
        },
      ];
    });
    rows.sort((a, b) => (order === 'asc' ? a.value - b.value : b.value - a.value));
    return { metric, period: p.label, order, total: rows.length, plants: rows.slice(0, limit) };
  },
});

const groupKey = (p: ZonePlant, by: 'postal_code' | 'colonia' | 'city') =>
  by === 'postal_code' ? p.postalCode : by === 'colonia' ? p.colonia : p.client.city;

/** Métrica de un grupo de plantas con sumas (no promedios de plantas). */
async function groupMetric(
  ctx: ToolContext,
  plantIds: string[],
  kwp: number,
  metric: 'pr_temp' | 'specific_yield' | 'energy_kwh',
  period: ResolvedPeriod,
): Promise<number | null> {
  const where = {
    plantId: { in: plantIds },
    date: { gte: dateOf(period.from), lte: dateOf(period.to) },
  };
  if (metric === 'pr_temp') {
    const s = await ctx.tx.plantDailyMetric.aggregate({
      where: { ...where, isValidDay: true },
      _sum: { energyKwh: true, expectedTempKwh: true },
    });
    const exp = s._sum.expectedTempKwh?.toNumber() ?? 0;
    return exp > 0 ? r3((s._sum.energyKwh?.toNumber() ?? 0) / exp) : null;
  }
  const s = await ctx.tx.plantDailyMetric.aggregate({ where, _sum: { energyKwh: true } });
  const energy = s._sum.energyKwh?.toNumber() ?? null;
  if (energy === null) return null;
  return metric === 'energy_kwh' ? r1(energy) : r1(energy / kwp);
}

export const performanceByZone = defineTool({
  name: 'performance_by_zone',
  description:
    'Rendimiento por zona (código postal, colonia o ciudad) en un periodo: número de plantas, kWp total y la métrica del grupo (pr_temp, specific_yield en kWh/kWp, o energy_kwh). Solo zonas con al menos min_plants plantas. Ordenado de mayor a menor.',
  input: z
    .object({
      group_by: z.enum(['postal_code', 'colonia', 'city']),
      metric: z.enum(['pr_temp', 'specific_yield', 'energy_kwh']),
      period: periodSchema,
      min_plants: z.number().int().min(1).max(50).default(2),
      zone: zoneSchema.optional(),
    })
    .strict(),
  run: async ({ group_by, metric, period, min_plants, zone }, ctx) => {
    const p = resolvePeriod(period, ctx.today);
    const plants = await plantsIn(ctx, zone);
    const groups = new Map<string, ZonePlant[]>();
    for (const x of plants) {
      const key = groupKey(x, group_by);
      groups.set(key, [...(groups.get(key) ?? []), x]);
    }
    const rows = [];
    for (const [zoneName, members] of groups) {
      if (members.length < min_plants) continue;
      const kwp = members.reduce((s, m) => s + m.capacityKwp.toNumber(), 0);
      const value = await groupMetric(
        ctx,
        members.map((m) => m.id),
        kwp,
        metric,
        p,
      );
      if (value === null) continue;
      rows.push({ zone: zoneName, plants: members.length, capacity_kwp: r1(kwp), value });
    }
    rows.sort((a, b) => b.value - a.value);
    return { group_by, metric, period: p.label, min_plants, zones: rows };
  },
});

export const comparePeriods = defineTool({
  name: 'compare_periods',
  description:
    'Compara una métrica (pr_temp, specific_yield o energy_kwh) entre dos periodos: valor A, valor B, diferencia absoluta y porcentual. group_by: none (flota), plant o zone (colonia).',
  input: z
    .object({
      metric: z.enum(['pr_temp', 'specific_yield', 'energy_kwh']),
      period_a: periodSchema,
      period_b: periodSchema,
      group_by: z.enum(['none', 'plant', 'zone']).default('none'),
      limit: limitSchema(10),
    })
    .strict(),
  run: async ({ metric, period_a, period_b, group_by, limit }, ctx) => {
    const pa = resolvePeriod(period_a, ctx.today);
    const pb = resolvePeriod(period_b, ctx.today);
    const plants = await plantsIn(ctx, undefined);
    const groups = new Map<string, { label: string; plants: ZonePlant[] }>();
    for (const x of plants) {
      const key = group_by === 'none' ? 'flota' : group_by === 'plant' ? x.id : x.colonia;
      const label =
        group_by === 'none' ? 'Toda la flota' : group_by === 'plant' ? x.name : x.colonia;
      const g = groups.get(key) ?? { label, plants: [] };
      g.plants.push(x);
      groups.set(key, g);
    }
    const rows = [];
    for (const [key, g] of groups) {
      const ids = g.plants.map((m) => m.id);
      const kwp = g.plants.reduce((s, m) => s + m.capacityKwp.toNumber(), 0);
      const [a, b] = await Promise.all([
        groupMetric(ctx, ids, kwp, metric, pa),
        groupMetric(ctx, ids, kwp, metric, pb),
      ]);
      const diff = a !== null && b !== null ? b - a : null;
      rows.push({
        ...(group_by === 'plant' ? { plant_id: key } : {}),
        name: g.label,
        value_a: a,
        value_b: b,
        diff: metric === 'pr_temp' ? r3(diff) : r1(diff),
        diff_pct: diff !== null && a ? r1((diff / a) * 100) : null,
      });
    }
    rows.sort((x, y) => Math.abs(y.diff ?? 0) - Math.abs(x.diff ?? 0));
    return {
      metric,
      period_a: pa.label,
      period_b: pb.label,
      note: 'diff = B − A; diff_pct relativo a A.',
      rows: rows.slice(0, limit),
    };
  },
});

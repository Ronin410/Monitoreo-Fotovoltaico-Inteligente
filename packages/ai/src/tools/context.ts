import {
  addDays,
  currentPlantStatus,
  daysBetween,
  startOfLocalDay,
  type DailyStatus,
} from '@pv/core';
import type { Prisma, TenantDb } from '@pv/db';
import { z } from 'zod';

// Piezas comunes de las herramientas del asistente (specs/07 §2). Todas corren dentro de
// withTenant(companyId): el companyId nunca es parámetro de una herramienta.

export type ToolContext = {
  /** Transacción de la empresa de la sesión (RLS). */
  tx: TenantDb;
  timezone: string;
  /** Hoy en la zona de la empresa (YYYY-MM-DD). */
  today: string;
  now: Date;
};

export class ToolError extends Error {}
export const notFound = () => new ToolError('Planta no encontrada');

// Parámetros comunes
export const MAX_PERIOD_DAYS = 400;
export const PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_year',
] as const;
// Patrón simple (el de z.iso.date() infla el esquema que lee el modelo); la fecha real se valida
// al resolver el periodo.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD');

export const periodSchema = z
  .union([
    z.object({ preset: z.enum(PRESETS) }).strict(),
    z.object({ from: isoDate, to: isoDate }).strict(),
  ])
  .describe(
    'Periodo: { "preset": ... } o { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } (máximo 400 días). Fechas en la zona horaria de la empresa.',
  );
export type Period = z.infer<typeof periodSchema>;

export const zoneSchema = z
  .object({
    postal_codes: z
      .array(z.string().regex(/^\d{5}$/))
      .max(50)
      .optional(),
    colonias: z.array(z.string().min(1).max(120)).max(50).optional(),
    city: z.string().min(1).max(120).optional(),
  })
  .strict()
  .describe('Filtro por zona: códigos postales, colonias o ciudad.');
export type Zone = z.infer<typeof zoneSchema>;

export const limitSchema = (def: number) =>
  z.number().int().min(1).max(50).default(def).describe('Máximo 50.');

export type ResolvedPeriod = { from: string; to: string; days: number; label: string };

/**
 * Fechas del periodo. Los periodos de "últimos N días" terminan ayer (último día completo); "este
 * mes" y "este año" llegan a hoy.
 */
export function resolvePeriod(period: Period, today: string): ResolvedPeriod {
  let from: string;
  let to: string;
  let label: string;
  if ('from' in period) {
    for (const d of [period.from, period.to]) {
      if (
        Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ||
        dateOf(d).toISOString().slice(0, 10) !== d
      ) {
        throw new ToolError(`Fecha inválida: ${d}`);
      }
    }
    if (period.from > period.to) throw new ToolError('from debe ser anterior o igual a to');
    ({ from, to } = period);
    label = `del ${from} al ${to}`;
  } else {
    const yesterday = addDays(today, -1);
    const month = today.slice(0, 7);
    switch (period.preset) {
      case 'today':
        [from, to, label] = [today, today, 'hoy'];
        break;
      case 'yesterday':
        [from, to, label] = [yesterday, yesterday, 'ayer'];
        break;
      case 'last_7_days':
        [from, to, label] = [addDays(today, -7), yesterday, 'últimos 7 días'];
        break;
      case 'last_30_days':
        [from, to, label] = [addDays(today, -30), yesterday, 'últimos 30 días'];
        break;
      case 'this_month':
        [from, to, label] = [`${month}-01`, today, 'este mes'];
        break;
      case 'last_month': {
        const end = addDays(`${month}-01`, -1);
        [from, to, label] = [`${end.slice(0, 7)}-01`, end, 'el mes pasado'];
        break;
      }
      case 'this_year':
        [from, to, label] = [`${today.slice(0, 4)}-01-01`, today, 'este año'];
        break;
    }
  }
  const days = daysBetween(from, to) + 1;
  if (days > MAX_PERIOD_DAYS) throw new ToolError('El periodo máximo es de 400 días');
  return { from, to, days, label: `${label} (${from} a ${to})` };
}

export const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);
/** Instante del inicio del día local `day` (+ `offset` días), para filtrar fechas con hora. */
export const startOfPeriod = (day: string, ctx: ToolContext, offset = 0) =>
  startOfLocalDay(addDays(day, offset), ctx.timezone);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());

/** Redondeos de las salidas (specs/07 §2): PR a 3 decimales, energía y porcentajes a 1. */
export const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
export const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
export const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/** Filtro de plantas activas (no borradas) en una zona. */
export function plantWhere(zone: Zone | undefined): Prisma.SolarPlantWhereInput {
  return {
    deletedAt: null,
    ...(zone?.postal_codes?.length && { postalCode: { in: zone.postal_codes } }),
    ...(zone?.colonias?.length && {
      OR: zone.colonias.map((c) => ({ colonia: { equals: c, mode: 'insensitive' as const } })),
    }),
    ...(zone?.city && { client: { city: { equals: zone.city, mode: 'insensitive' } } }),
  };
}

export const OPEN_ALERT = ['open', 'acknowledged'] as const;
const RECENT_DAYS = 2;

/** Estado actual de cada planta (como el tablero): alertas abiertas y el último día reciente. */
export async function currentStatuses(
  ctx: ToolContext,
  plantIds: string[],
): Promise<Map<string, DailyStatus>> {
  const [alerts, recent] = await Promise.all([
    ctx.tx.alert.findMany({
      where: { plantId: { in: plantIds }, status: { in: [...OPEN_ALERT] } },
      select: { plantId: true, type: true, severity: true },
    }),
    ctx.tx.plantDailyMetric.findMany({
      where: { plantId: { in: plantIds }, date: { gte: dateOf(addDays(ctx.today, -RECENT_DAYS)) } },
      orderBy: { date: 'desc' },
      select: { plantId: true, status: true },
    }),
  ]);
  return new Map(
    plantIds.map((id) => [
      id,
      currentPlantStatus({
        openAlerts: alerts.filter((a) => a.plantId === id),
        lastDailyStatus: recent.find((m) => m.plantId === id)?.status ?? null,
      }),
    ]),
  );
}

export type PlantAggregate = {
  energy_kwh: number;
  /** Σ energía / Σ esperada de los días válidos (specs/07 §2). */
  pr_temp: number | null;
  valid_days: number;
  days_with_data: number;
  /** Días sin telemetría (offline) del periodo. */
  offline_days: number;
  deviation_avg: number | null;
  neighbor_index_avg: number | null;
};

/** Agregados por planta de plant_daily_metrics en el periodo (una consulta por tipo de día). */
export async function aggregateByPlant(
  ctx: ToolContext,
  plantIds: string[],
  period: ResolvedPeriod,
): Promise<Map<string, PlantAggregate>> {
  const where = {
    plantId: { in: plantIds },
    date: { gte: dateOf(period.from), lte: dateOf(period.to) },
  };
  const [all, valid, offline] = await Promise.all([
    ctx.tx.plantDailyMetric.groupBy({
      by: ['plantId'],
      where,
      _sum: { energyKwh: true },
      _count: { _all: true },
    }),
    ctx.tx.plantDailyMetric.groupBy({
      by: ['plantId'],
      where: { ...where, isValidDay: true },
      _sum: { energyKwh: true, expectedTempKwh: true },
      _avg: { deviationPct: true, neighborIndex: true },
      _count: { _all: true },
    }),
    ctx.tx.plantDailyMetric.groupBy({
      by: ['plantId'],
      where: { ...where, invalidReason: 'offline' },
      _count: { _all: true },
    }),
  ]);
  const out = new Map<string, PlantAggregate>();
  for (const id of plantIds) {
    const a = all.find((x) => x.plantId === id);
    const v = valid.find((x) => x.plantId === id);
    const expected = dec(v?._sum.expectedTempKwh ?? null) ?? 0;
    out.set(id, {
      energy_kwh: dec(a?._sum.energyKwh ?? null) ?? 0,
      pr_temp: expected > 0 ? (dec(v?._sum.energyKwh ?? null) ?? 0) / expected : null,
      valid_days: v?._count._all ?? 0,
      days_with_data: a?._count._all ?? 0,
      offline_days: offline.find((x) => x.plantId === id)?._count._all ?? 0,
      deviation_avg: dec(v?._avg.deviationPct ?? null),
      neighbor_index_avg: dec(v?._avg.neighborIndex ?? null),
    });
  }
  return out;
}

/** Último día calculado reciente con predicción de lavado. */
export async function latestPrediction(ctx: ToolContext, plantIds: string[]) {
  const rows = await ctx.tx.plantDailyMetric.findMany({
    where: { plantId: { in: plantIds }, date: { gte: dateOf(addDays(ctx.today, -RECENT_DAYS)) } },
    orderBy: { date: 'desc' },
    select: {
      plantId: true,
      date: true,
      prTemp: true,
      prBaseline: true,
      baselineSource: true,
      deviationPct: true,
      daysToCleaning: true,
      predictionConfidence: true,
    },
  });
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.plantId)) out.set(r.plantId, r);
  return out;
}

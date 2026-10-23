import { z } from 'zod';
import {
  aggregateByPlant,
  currentStatuses,
  dateOf,
  dec,
  isoDay,
  latestPrediction,
  limitSchema,
  notFound,
  OPEN_ALERT,
  periodSchema,
  plantWhere,
  r1,
  r2,
  r3,
  resolvePeriod,
  zoneSchema,
  type ToolContext,
} from './context.js';
import { defineTool } from './tool.js';

// Plantas: búsqueda, detalle y serie diaria. Nunca datos de contacto (specs/07 §2).

const STATUS = z.enum(['ok', 'warning', 'critical', 'offline', 'no_data']);
const uuid = z.uuid({ error: 'plant_id debe ser un UUID de search_plants' });

/** La planta de la empresa (RLS) o "no encontrada". */
async function plantOf(ctx: ToolContext, id: string) {
  const plant = await ctx.tx.solarPlant.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      colonia: true,
      postalCode: true,
      capacityKwp: true,
      tiltDeg: true,
      azimuthDeg: true,
      inverterBrand: true,
      status: true,
      commissioningDate: true,
      createdAt: true,
      client: { select: { name: true, city: true } },
    },
  });
  if (!plant) throw notFound();
  return plant;
}

export const searchPlants = defineTool({
  name: 'search_plants',
  description:
    'Busca plantas por nombre de planta o de cliente, zona o estado actual. Devuelve id (para otras herramientas), nombre, cliente, colonia, CP, kWp, estado, último PR corregido, días para el lavado, fuente de la línea base y fecha de alta.',
  input: z
    .object({
      query: z.string().min(1).max(120).optional(),
      zone: zoneSchema.optional(),
      status: STATUS.optional().describe('Estado actual: ok, warning, critical, offline, no_data'),
      limit: limitSchema(20),
    })
    .strict(),
  run: async ({ query, zone, status, limit }, ctx) => {
    const plants = await ctx.tx.solarPlant.findMany({
      where: {
        ...plantWhere(zone),
        ...(query && {
          AND: [
            {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { client: { name: { contains: query, mode: 'insensitive' } } },
              ],
            },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        name: true,
        colonia: true,
        postalCode: true,
        capacityKwp: true,
        status: true,
        commissioningDate: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });
    const ids = plants.map((p) => p.id);
    const [statuses, latest] = await Promise.all([
      currentStatuses(ctx, ids),
      latestPrediction(ctx, ids),
    ]);
    const rows = plants
      .map((p) => {
        const m = latest.get(p.id);
        return {
          id: p.id,
          name: p.name,
          client: p.client.name,
          colonia: p.colonia,
          postal_code: p.postalCode,
          capacity_kwp: r1(p.capacityKwp.toNumber()),
          monitoring: p.status,
          status: statuses.get(p.id) ?? 'no_data',
          last_pr_temp: r3(dec(m?.prTemp ?? null)),
          days_to_cleaning: m?.daysToCleaning ?? null,
          baseline_source: m?.baselineSource ?? null,
          installed_on: isoDay(p.commissioningDate ?? p.createdAt),
        };
      })
      .filter((r) => !status || r.status === status);
    return { total: rows.length, plants: rows.slice(0, limit) };
  },
});

export const getPlantDetail = defineTool({
  name: 'get_plant_detail',
  description:
    'Detalle de una planta: datos técnicos (sin contacto), línea base, resumen de 30 días, tendencia de suciedad, última limpieza, alertas abiertas con su resumen y tickets abiertos.',
  input: z.object({ plant_id: uuid }).strict(),
  run: async ({ plant_id }, ctx) => {
    const plant = await plantOf(ctx, plant_id);
    const period = resolvePeriod({ preset: 'last_30_days' }, ctx.today);
    const [agg, latest, cleaning, alerts, tickets, statuses] = await Promise.all([
      aggregateByPlant(ctx, [plant.id], period),
      ctx.tx.plantDailyMetric.findFirst({
        where: { plantId: plant.id, date: { lte: dateOf(ctx.today) } },
        orderBy: { date: 'desc' },
        select: {
          date: true,
          prBaseline: true,
          baselineSource: true,
          deviationPct: true,
          soilingSlopePctPerDay: true,
          daysToCleaning: true,
          predictionConfidence: true,
        },
      }),
      ctx.tx.plantEvent.findFirst({
        where: { plantId: plant.id, type: { in: ['cleaning', 'rain_cleaning'] } },
        orderBy: { occurredAt: 'desc' },
        select: { type: true, occurredAt: true },
      }),
      ctx.tx.alert.findMany({
        where: { plantId: plant.id, status: { in: [...OPEN_ALERT] } },
        orderBy: { detectedAt: 'desc' },
        select: { id: true, type: true, severity: true, detectedAt: true, aiExplanation: true },
      }),
      ctx.tx.maintenanceTicket.findMany({
        where: { plantId: plant.id, status: { in: ['pending', 'scheduled', 'in_progress'] } },
        select: {
          type: true,
          status: true,
          scheduledFor: true,
          assignedTo: { select: { name: true } },
        },
      }),
      currentStatuses(ctx, [plant.id]),
    ]);
    const a = agg.get(plant.id);
    const installed = isoDay(plant.commissioningDate ?? plant.createdAt);
    return {
      plant: {
        id: plant.id,
        name: plant.name,
        client: plant.client.name,
        colonia: plant.colonia,
        postal_code: plant.postalCode,
        city: plant.client.city,
        capacity_kwp: r1(plant.capacityKwp.toNumber()),
        tilt_deg: plant.tiltDeg.toNumber(),
        azimuth_deg: plant.azimuthDeg.toNumber(),
        inverter_brand: plant.inverterBrand,
        monitoring: plant.status,
        installed_on: installed,
        status: statuses.get(plant.id) ?? 'no_data',
      },
      baseline: {
        pr: r3(dec(latest?.prBaseline ?? null)),
        source: latest?.baselineSource ?? null,
        // Línea base propia: la planta ya tiene historia suficiente; si no, es provisional.
        provisional: latest?.baselineSource !== 'own',
      },
      last_30_days: {
        period: period.label,
        energy_kwh: r1(a?.energy_kwh ?? 0),
        pr_temp: r3(a?.pr_temp ?? null),
        valid_days: a?.valid_days ?? 0,
        deviation_avg_pct: r1(a?.deviation_avg ?? null),
      },
      soiling: {
        deviation_pct: r1(dec(latest?.deviationPct ?? null)),
        slope_pct_per_day: r2(dec(latest?.soilingSlopePctPerDay ?? null)),
        days_to_cleaning: latest?.daysToCleaning ?? null,
        confidence: latest?.predictionConfidence ?? null,
        as_of: latest ? isoDay(latest.date) : null,
      },
      last_cleaning: cleaning ? { type: cleaning.type, date: isoDay(cleaning.occurredAt) } : null,
      open_alerts: alerts.map((x) => ({
        id: x.id,
        type: x.type,
        severity: x.severity,
        detected_on: isoDay(x.detectedAt),
        summary:
          x.aiExplanation && typeof x.aiExplanation === 'object' && 'resumen' in x.aiExplanation
            ? String((x.aiExplanation as { resumen: unknown }).resumen)
            : null,
      })),
      open_tickets: tickets.map((t) => ({
        type: t.type,
        status: t.status,
        scheduled_for: t.scheduledFor ? isoDay(t.scheduledFor) : null,
        assigned_to: t.assignedTo?.name ?? null,
      })),
    };
  },
});

const SERIES_METRICS = {
  energy_kwh: 'energyKwh',
  pr_temp: 'prTemp',
  deviation_pct: 'deviationPct',
  irradiation_poa_kwh_m2: 'irradiationPoaKwhM2',
  specific_yield: 'specificYieldKwhKwp',
} as const;

export const getPlantTimeseries = defineTool({
  name: 'get_plant_timeseries',
  description:
    'Serie diaria de una métrica de una planta en un periodo (máximo 400 puntos). pr_temp y deviation_pct solo en días válidos; en días no válidos el valor es null.',
  input: z
    .object({
      plant_id: uuid,
      metric: z.enum([
        'energy_kwh',
        'pr_temp',
        'deviation_pct',
        'irradiation_poa_kwh_m2',
        'specific_yield',
      ]),
      period: periodSchema,
    })
    .strict(),
  run: async ({ plant_id, metric, period }, ctx) => {
    const plant = await plantOf(ctx, plant_id);
    const p = resolvePeriod(period, ctx.today);
    const field = SERIES_METRICS[metric];
    const rows = await ctx.tx.plantDailyMetric.findMany({
      where: { plantId: plant.id, date: { gte: dateOf(p.from), lte: dateOf(p.to) } },
      orderBy: { date: 'asc' },
      take: 400,
      select: {
        date: true,
        isValidDay: true,
        rainMm: true,
        energyKwh: true,
        prTemp: true,
        deviationPct: true,
        irradiationPoaKwhM2: true,
        specificYieldKwhKwp: true,
      },
    });
    const validOnly = metric === 'pr_temp' || metric === 'deviation_pct';
    const round = metric === 'pr_temp' ? r3 : r1;
    return {
      plant: { id: plant.id, name: plant.name },
      metric,
      period: p.label,
      points: rows.map((r) => {
        const raw = dec(r[field]);
        return {
          date: isoDay(r.date),
          value: validOnly && !r.isValidDay ? null : round(raw),
          valid: r.isValidDay,
          ...(dec(r.rainMm) ? { rain_mm: r1(dec(r.rainMm)) } : {}),
        };
      }),
    };
  },
});

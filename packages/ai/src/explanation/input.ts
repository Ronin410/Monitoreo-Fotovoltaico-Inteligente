import { addDays, estimatedDailyLossKwh, localDate, parseCompanySettings } from '@pv/core';
import type { Alert, Prisma, TenantDb } from '@pv/db';
import type { ExplainInput } from './schema.js';

// Datos de una alerta para su explicación (specs/07 §3 §Entrada) y su pérdida estimada por día.
// Todas las cifras las calcula nuestro código; la IA solo las interpreta.

/** Días recientes con que se estima la pérdida de offline o de una alerta sin días disparadores. */
const LOSS_FALLBACK_DAYS = 3;
const EVENT_DAYS = 90;
const TICKET_DAYS = 90;

const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());
const asObject = (v: Prisma.JsonValue | null): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type EstimatedLoss = {
  kwh_per_day: number;
  mxn_per_day: number;
  tariff_mxn_per_kwh: number;
} | null;

type AlertForLoss = Pick<Alert, 'type' | 'plantId' | 'detectedAt' | 'evidence'>;

/**
 * Pérdida por día (specs/07 §3): promedio en los días disparadores de `expected_temp_kwh ×
 * pr_baseline − energy_kwh`; para offline, lo que debió producir los últimos días. En pesos con la
 * tarifa del cliente o, si no tiene, la de la empresa. `tx` es el de la empresa (withTenant).
 */
export async function estimateAlertLoss(tx: TenantDb, alert: AlertForLoss): Promise<EstimatedLoss> {
  if (alert.type === 'cleaning_due_soon') return null;
  const trigger = asObject((asObject(alert.evidence)?.trigger ?? null) as Prisma.JsonValue);
  const dates = Array.isArray(trigger?.dates)
    ? (trigger.dates as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  const byTrigger = dates.length > 0 && alert.type !== 'offline';
  const metrics = await tx.plantDailyMetric.findMany({
    where: {
      plantId: alert.plantId,
      ...(byTrigger
        ? { date: { in: dates.map((d) => new Date(`${d}T00:00:00Z`)) } }
        : { date: { lte: alert.detectedAt } }),
    },
    orderBy: { date: 'desc' },
    take: byTrigger ? dates.length : LOSS_FALLBACK_DAYS,
    select: { expectedTempKwh: true, prTemp: true, prBaseline: true, isValidDay: true },
  });
  const kwh = estimatedDailyLossKwh(
    alert.type === 'offline' ? 'no_production' : 'underperformance',
    metrics.map((m) => ({
      expectedTempKwh: Number(m.expectedTempKwh),
      prTemp: dec(m.prTemp),
      prBaseline: dec(m.prBaseline),
      isValidDay: m.isValidDay,
    })),
  );
  if (kwh === null) return null;
  const plant = await tx.solarPlant.findUniqueOrThrow({
    where: { id: alert.plantId },
    select: {
      client: { select: { tariffMxnPerKwh: true } },
      company: { select: { settings: true } },
    },
  });
  const tariff =
    dec(plant.client.tariffMxnPerKwh) ??
    parseCompanySettings(plant.company.settings).defaults.tariff_mxn_per_kwh;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { kwh_per_day: round(kwh), mxn_per_day: round(kwh * tariff), tariff_mxn_per_kwh: tariff };
}

/**
 * Entrada de la explicación: alerta, evidencia con la pérdida, datos técnicos de la planta (sin
 * datos de contacto), eventos de 90 días y tickets recientes.
 */
export async function buildExplainInput(
  tx: TenantDb,
  alert: Alert,
  timezone: string,
  now: Date,
): Promise<ExplainInput> {
  const today = localDate(now, timezone);
  const since = new Date(`${addDays(today, -EVENT_DAYS)}T00:00:00Z`);
  const [plant, events, tickets, loss] = await Promise.all([
    tx.solarPlant.findUniqueOrThrow({
      where: { id: alert.plantId },
      select: {
        capacityKwp: true,
        tiltDeg: true,
        azimuthDeg: true,
        inverterBrand: true,
        commissioningDate: true,
      },
    }),
    tx.plantEvent.findMany({
      where: {
        plantId: alert.plantId,
        type: { in: ['cleaning', 'rain_cleaning', 'repair', 'inverter_replaced'] },
        occurredAt: { gte: since },
      },
      orderBy: { occurredAt: 'asc' },
      select: { type: true, occurredAt: true },
    }),
    tx.maintenanceTicket.findMany({
      where: {
        plantId: alert.plantId,
        createdAt: { gte: new Date(now.getTime() - TICKET_DAYS * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { type: true, status: true, createdAt: true },
    }),
    estimateAlertLoss(tx, alert),
  ]);
  const ageYears = plant.commissioningDate
    ? Math.round(
        ((now.getTime() - plant.commissioningDate.getTime()) / (365.25 * 86_400_000)) * 10,
      ) / 10
    : null;
  return {
    alert: {
      type: alert.type,
      severity: alert.severity,
      detected_at: alert.detectedAt.toISOString(),
    },
    evidence: {
      ...(asObject(alert.evidence) ?? {}),
      estimated_loss_kwh_per_day: loss?.kwh_per_day ?? null,
      estimated_loss_mxn_per_day: loss?.mxn_per_day ?? null,
    },
    plant: {
      capacity_kwp: Number(plant.capacityKwp),
      tilt_deg: Number(plant.tiltDeg),
      azimuth_deg: Number(plant.azimuthDeg),
      age_years: ageYears,
      inverter_brand: plant.inverterBrand,
    },
    events: events.map((e) => ({ type: e.type, date: localDate(e.occurredAt, timezone) })),
    tickets: tickets.map((t) => ({ type: t.type, status: t.status, date: isoDay(t.createdAt) })),
    today,
  };
}

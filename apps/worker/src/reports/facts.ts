import {
  addDays,
  buildReportFacts,
  daysBetween,
  localDate,
  parseCompanySettings,
  periodDays,
  plantInPeriod,
  shiftPeriod,
  startOfLocalDay,
  sunHourCoverage,
  type ReportFacts,
  type ReportPlantInput,
} from '@pv/core';
import type { Company, Prisma, TenantDb } from '@pv/db';

// Datos de un cliente en un mes para su reporte (specs/08 §2). `tx` es el de la empresa.

const ALERT_LABELS: Record<string, string> = {
  offline: 'sin datos',
  sudden_drop: 'caída de producción',
  soiling: 'posible suciedad',
  cleaning_due_soon: 'lavado próximo',
};

const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());
const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);

/** Plantas del cliente que estuvieron activas al menos un día del periodo. */
export async function reportPlants(
  tx: TenantDb,
  clientId: string,
  period: string,
  timezone: string,
) {
  const plants = await tx.solarPlant.findMany({ where: { clientId }, orderBy: { name: 'asc' } });
  return plants.filter((p) => plantInPeriod(p, period, timezone));
}

async function clientEnergy(
  tx: TenantDb,
  plantIds: string[],
  period: string,
): Promise<number | null> {
  const { first, last } = periodDays(period);
  const sum = await tx.plantDailyMetric.aggregate({
    where: { plantId: { in: plantIds }, date: { gte: dateOf(first), lte: dateOf(last) } },
    _sum: { energyKwh: true },
    _count: { _all: true },
  });
  return sum._count._all > 0 ? num(sum._sum.energyKwh) : null;
}

export async function computeReportFacts(
  tx: TenantDb,
  company: Company,
  clientId: string,
  period: string,
): Promise<ReportFacts> {
  const tz = company.timezone;
  const settings = parseCompanySettings(company.settings);
  const client = await tx.client.findFirstOrThrow({ where: { id: clientId } });
  const plants = await reportPlants(tx, clientId, period, tz);
  const ids = plants.map((p) => p.id);
  const { first, last } = periodDays(period);
  const from = startOfLocalDay(first, tz);
  const to = startOfLocalDay(addDays(last, 1), tz);

  const metrics = await tx.plantDailyMetric.findMany({
    where: { plantId: { in: ids }, date: { gte: dateOf(first), lte: dateOf(last) } },
    orderBy: { date: 'asc' },
  });
  const inputs: ReportPlantInput[] = [];
  for (const p of plants) {
    const installed = localDate(p.commissioningDate ?? p.createdAt, tz);
    const firstDay = installed > first ? installed : first;
    const since = startOfLocalDay(firstDay, tz);
    const readings = await tx.telemetryReading.findMany({
      where: { plantId: p.id, ts: { gte: since, lt: to } },
      select: { ts: true },
    });
    const coverage =
      p.lat !== null && p.lon !== null
        ? sunHourCoverage(
            since,
            to,
            num(p.lat) ?? 0,
            num(p.lon) ?? 0,
            readings.map((r) => r.ts),
          )
        : { sunHours: 0, withData: 0 };
    inputs.push({
      name: p.name,
      capacityKwp: p.capacityKwp.toNumber(),
      firstDay,
      daysInPeriod: daysBetween(firstDay, last) + 1,
      days: metrics
        .filter((m) => m.plantId === p.id)
        .map((m) => ({
          date: m.date.toISOString().slice(0, 10),
          energyKwh: m.energyKwh.toNumber(),
          expectedTempKwh: m.expectedTempKwh.toNumber(),
          isValidDay: m.isValidDay,
          rainMm: num(m.rainMm),
          cloudCoverAvgPct: num(m.cloudCoverAvgPct),
        })),
      sunHours: coverage.sunHours,
      sunHoursWithData: coverage.withData,
    });
  }

  const [opened, resolved, cleanings, open] = await Promise.all([
    tx.alert.count({ where: { plantId: { in: ids }, detectedAt: { gte: from, lt: to } } }),
    tx.alert.count({ where: { plantId: { in: ids }, resolvedAt: { gte: from, lt: to } } }),
    tx.plantEvent.count({
      where: { plantId: { in: ids }, type: 'cleaning', occurredAt: { gte: from, lt: to } },
    }),
    tx.alert.findMany({
      where: {
        plantId: { in: ids },
        detectedAt: { lt: to },
        OR: [{ status: { in: ['open', 'acknowledged'] } }, { resolvedAt: { gte: to } }],
      },
      include: { plant: { select: { name: true } } },
    }),
  ]);

  return buildReportFacts({
    period,
    clientName: client.name,
    plants: inputs,
    energyPrevMonthKwh: await clientEnergy(tx, ids, shiftPeriod(period, -1)),
    energySameMonthLastYearKwh: await clientEnergy(tx, ids, shiftPeriod(period, -12)),
    tariffMxnPerKwh: num(client.tariffMxnPerKwh) ?? settings.defaults.tariff_mxn_per_kwh,
    co2KgPerKwh: settings.defaults.co2_kg_per_kwh,
    avgMonthlyKwh: num(client.avgMonthlyKwh),
    alertsOpened: opened,
    alertsResolved: resolved,
    cleanings,
    // Lo que seguía abierto al cerrar el mes, en palabras del cliente.
    openIssues: open.map((a) => `${a.plant.name}: ${ALERT_LABELS[a.type] ?? a.type}`),
  });
}

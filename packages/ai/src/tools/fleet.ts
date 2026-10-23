import { z } from 'zod';
import {
  aggregateByPlant,
  currentStatuses,
  dateOf,
  latestPrediction,
  OPEN_ALERT,
  periodSchema,
  r1,
  r3,
  resolvePeriod,
} from './context.js';
import { defineTool } from './tool.js';

export const getFleetSummary = defineTool({
  name: 'get_fleet_summary',
  description:
    'Resumen de la flota en un periodo: plantas por estado actual, energía total, PR corregido de la flota (Σ energía / Σ esperada de días válidos), alertas abiertas por tipo, plantas sin datos y lavados previstos en 7 días.',
  input: z.object({ period: periodSchema }).strict(),
  run: async ({ period }, ctx) => {
    const p = resolvePeriod(period, ctx.today);
    const plants = await ctx.tx.solarPlant.findMany({
      where: { deletedAt: null, status: 'active' },
      select: { id: true, capacityKwp: true },
    });
    const ids = plants.map((x) => x.id);
    const [statuses, aggregates, predictions, alerts] = await Promise.all([
      currentStatuses(ctx, ids),
      aggregateByPlant(ctx, ids, p),
      latestPrediction(ctx, ids),
      ctx.tx.alert.groupBy({
        by: ['type'],
        where: { plantId: { in: ids }, status: { in: [...OPEN_ALERT] } },
        _count: { _all: true },
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const s of statuses.values()) byStatus[s] = (byStatus[s] ?? 0) + 1;
    const energy = [...aggregates.values()].reduce((sum, a) => sum + a.energy_kwh, 0);
    // PR de la flota con las sumas de todas las plantas (pondera por tamaño), no el promedio.
    const sums = await ctx.tx.plantDailyMetric.aggregate({
      where: {
        plantId: { in: ids },
        isValidDay: true,
        date: { gte: dateOf(p.from), lte: dateOf(p.to) },
      },
      _sum: { energyKwh: true, expectedTempKwh: true },
    });
    const expected = sums._sum.expectedTempKwh?.toNumber() ?? 0;
    const prFleet = expected > 0 ? (sums._sum.energyKwh?.toNumber() ?? 0) / expected : null;
    return {
      period: p.label,
      plants: {
        active: plants.length,
        capacity_kwp: r1(plants.reduce((s, x) => s + x.capacityKwp.toNumber(), 0)),
        by_status: byStatus,
      },
      energy_kwh: r1(energy),
      pr_temp: r3(prFleet),
      open_alerts_by_type: Object.fromEntries(alerts.map((a) => [a.type, a._count._all])),
      offline_plants: byStatus.offline ?? 0,
      cleanings_next_7_days: [...predictions.values()].filter(
        (m) => m.daysToCleaning !== null && m.daysToCleaning <= 7,
      ).length,
    };
  },
});

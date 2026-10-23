import type { SimulatorDataSource } from '@pv/adapters';
import { parseCompanySettings } from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';

/**
 * Fuente del simulador sobre la base de datos, dentro de la empresa: clima guardado de la planta,
 * sus limpiezas y el umbral de lluvia de la empresa.
 */
export function dbSimulatorSource(db: PrismaClient, companyId: string): SimulatorDataSource {
  return {
    load: ({ plantId, from, to }) =>
      withTenant(db, companyId, async (tx) => {
        const [weather, cleanings, company] = await Promise.all([
          tx.plantWeatherHourly.findMany({
            where: { plantId, ts: { gte: from, lt: to } },
            select: { ts: true, poaWm2: true, tempAmbC: true, precipitationMm: true },
            orderBy: { ts: 'asc' },
          }),
          tx.plantEvent.findMany({
            where: { plantId, type: 'cleaning', occurredAt: { lt: to } },
            select: { occurredAt: true },
          }),
          tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } }),
        ]);
        return {
          weather: weather.map((h) => ({
            ts: h.ts,
            poaWm2: Number(h.poaWm2),
            tempAmbC: Number(h.tempAmbC),
            precipitationMm: Number(h.precipitationMm),
          })),
          cleanings: cleanings.map((c) => c.occurredAt),
          rainResetMm: parseCompanySettings(company.settings).thresholds.rain_reset_mm,
        };
      }),
  };
}

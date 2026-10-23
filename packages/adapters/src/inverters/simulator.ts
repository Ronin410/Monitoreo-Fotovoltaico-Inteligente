import { simulateReadings, startOfLocalDay, localDate, type SimWeatherHour } from '@pv/core';
import type { InverterAdapter, PlantForAdapter, RawReading } from './types.js';

// Inversor simulado (specs/04 §3): genera la telemetría a partir del clima guardado de la planta.
// La simulación es una función pura de packages/core; este adaptador solo reúne sus datos.

/** De dónde saca el simulador el clima, las limpiezas y el umbral de lluvia de la planta. */
export interface SimulatorDataSource {
  load(args: { plantId: string; from: Date; to: Date }): Promise<{
    weather: SimWeatherHour[];
    /** Eventos `cleaning` de la planta (reinician la suciedad). */
    cleanings: Date[];
    /** settings.thresholds.rain_reset_mm de la empresa. */
    rainResetMm: number;
  }>;
}

const DAY_MS = 24 * 3_600_000;
/** Historia máxima de clima para calcular la suciedad (desde el último lavado). */
const MAX_HISTORY_DAYS = 400;

/** Desde cuándo hace falta el clima: medianoche local de `since` o el inicio de la suciedad. */
function weatherStart(plant: PlantForAdapter, since: Date): Date {
  const tz = plant.timezone;
  let from = startOfLocalDay(localDate(since, tz), tz).getTime();
  for (const s of plant.simulationProfile?.scenarios ?? []) {
    if (s.type === 'soiling') from = Math.min(from, startOfLocalDay(s.start, tz).getTime());
  }
  return new Date(Math.max(from, since.getTime() - MAX_HISTORY_DAYS * DAY_MS));
}

export function createSimulatorAdapter(source?: SimulatorDataSource): InverterAdapter {
  return {
    provider: 'simulator',
    // No necesita credenciales reales.
    testConnection: async () => ({ ok: true }),
    fetchReadings: async ({ plant, since, until }): Promise<RawReading[]> => {
      if (!source) throw new Error('El simulador necesita una fuente de datos (solo en el worker)');
      if (!plant.simulationProfile)
        throw new Error('La planta simulada no tiene simulation_profile');
      const data = await source.load({
        plantId: plant.id,
        from: weatherStart(plant, since),
        to: until,
      });
      return simulateReadings({
        plant: {
          id: plant.id,
          capacityKwp: plant.capacityKwp,
          noctC: plant.noctC,
          gammaPctPerC: plant.gammaPctPerC,
          timezone: plant.timezone,
          profile: plant.simulationProfile,
        },
        weather: data.weather,
        cleanings: data.cleanings,
        rainResetMm: data.rainResetMm,
        since,
        until,
      });
    },
  };
}

import { z } from 'zod';
import { companyPayload, defineJob } from './queue/definition.js';

// Jobs del sistema (specs/01 §Jobs). Definiciones compartidas: la api encola, el worker ejecuta.

/** Orquestador horario: encola el clima de cada empresa activa (specs/04 §2). */
export const ingestWeather = defineJob({
  name: 'ingest.weather',
  payload: z.object({}),
  scope: 'platform',
  retryLimit: 1,
  // Unos minutos después de la hora para que el proveedor tenga la hora recién cerrada.
  schedule: { cron: '5 * * * *' },
});

/** Clima de las plantas activas de una empresa en un rango (por defecto las últimas 3 horas). */
export const ingestWeatherCompany = defineJob({
  name: 'ingest.weather_company',
  payload: companyPayload.extend({
    /** Hora de corte (UTC); por defecto la hora actual. */
    at: z.iso.datetime().optional(),
  }),
  scope: 'company',
  singletonKey: (p) => `ingest.weather_company:${p.company_id}:${p.at ?? 'now'}`,
});

/** Backfill de clima de una planta al crearla o al cambiar su ubicación u orientación. */
export const weatherBackfill = defineJob({
  name: 'weather.backfill',
  payload: companyPayload.extend({
    plant_id: z.uuid(),
    days: z.number().int().min(1).max(90).default(90),
  }),
  scope: 'company',
  expireInSeconds: 30 * 60,
  singletonKey: (p) => `weather.backfill:${p.plant_id}`,
});

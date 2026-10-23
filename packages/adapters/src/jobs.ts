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

/** Orquestador cada 15 min: encola la telemetría de cada planta activa con sol (specs/04 §1). */
export const ingestTelemetry = defineJob({
  name: 'ingest.telemetry',
  payload: z.object({}),
  scope: 'platform',
  retryLimit: 1,
  schedule: { cron: '*/15 * * * *' },
});

/** Telemetría de una planta: lee el inversor, normaliza a 15 min y guarda. */
export const ingestTelemetryPlant = defineJob({
  name: 'ingest.telemetry_plant',
  payload: companyPayload.extend({ plant_id: z.uuid() }),
  scope: 'company',
  // specs/04: backoff exponencial ante 429 o 5xx; tras 3 fallos se registra en job_runs.
  retryLimit: 3,
  retryDelaySeconds: 30,
  // specs/04: concurrencia máxima por proveedor, por defecto 5.
  concurrency: 5,
  expireInSeconds: 5 * 60,
  singletonKey: (p) => `ingest.telemetry_plant:${p.plant_id}`,
});

const localDateSchema = z.iso.date();

/**
 * Orquestador horario de métricas: a las 22:00 locales de cada empresa encola el cálculo del día
 * (specs/05 §9). pg-boss programa en una sola zona, por eso se revisa cada hora.
 */
export const metricsDaily = defineJob({
  name: 'metrics.daily',
  payload: z.object({}),
  scope: 'platform',
  retryLimit: 1,
  schedule: { cron: '10 * * * *' },
});

/** Métricas diarias de todas las plantas activas de una empresa para una fecha local. */
export const metricsDailyCompany = defineJob({
  name: 'metrics.daily_company',
  payload: companyPayload.extend({ date: localDateSchema }),
  scope: 'company',
  expireInSeconds: 30 * 60,
  singletonKey: (p) => `metrics.daily_company:${p.company_id}:${p.date}`,
});

/** Recálculo a mano de un rango de fechas, en orden (cada día usa los anteriores). */
export const metricsRecompute = defineJob({
  name: 'metrics.recompute',
  payload: companyPayload
    .extend({ from: localDateSchema, to: localDateSchema })
    .refine((p) => p.from <= p.to, { error: 'from debe ser anterior o igual a to' })
    .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 <= 400, {
      error: 'El rango máximo es de 400 días',
    }),
  scope: 'company',
  retryLimit: 1,
  expireInSeconds: 60 * 60,
  singletonKey: (p) => `metrics.recompute:${p.company_id}`,
});

/** Reglas diarias de alertas (specs/06) de una empresa para una fecha, tras metrics.daily_company. */
export const alertsEvaluate = defineJob({
  name: 'alerts.evaluate',
  payload: companyPayload.extend({ date: localDateSchema }),
  scope: 'company',
  expireInSeconds: 15 * 60,
  singletonKey: (p) => `alerts.evaluate:${p.company_id}:${p.date}`,
});

/** Orquestador horario de la regla offline: encola alerts.offline_company por empresa activa. */
export const alertsOffline = defineJob({
  name: 'alerts.offline',
  payload: z.object({}),
  scope: 'platform',
  retryLimit: 1,
  // Después de la ingesta de telemetría de :15 para que las lecturas recientes ya estén.
  schedule: { cron: '20 * * * *' },
});

/** Regla offline (horas con sol sin lecturas) de las plantas de una empresa. */
export const alertsOfflineCompany = defineJob({
  name: 'alerts.offline_company',
  payload: companyPayload,
  scope: 'company',
  expireInSeconds: 10 * 60,
  singletonKey: (p) => `alerts.offline_company:${p.company_id}`,
});

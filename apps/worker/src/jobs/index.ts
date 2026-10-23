import type { RegisteredJob } from '../runtime.js';
import { alertsEvaluateJob, alertsOfflineCompanyJob, alertsOfflineJob } from './alerts.js';
import { heartbeatJob } from './heartbeat.js';
import { metricsDailyCompanyJob, metricsDailyJob, metricsRecomputeJob } from './metrics.js';
import { ingestTelemetryJob, ingestTelemetryPlantJob } from './telemetry.js';
import { ingestWeatherCompanyJob, ingestWeatherJob, weatherBackfillJob } from './weather.js';

/** Jobs que atiende el worker. Cada fase agrega los suyos. */
export const JOBS: RegisteredJob[] = [
  heartbeatJob,
  ingestWeatherJob,
  ingestWeatherCompanyJob,
  weatherBackfillJob,
  ingestTelemetryJob,
  ingestTelemetryPlantJob,
  metricsDailyJob,
  metricsDailyCompanyJob,
  metricsRecomputeJob,
  alertsEvaluateJob,
  alertsOfflineJob,
  alertsOfflineCompanyJob,
];

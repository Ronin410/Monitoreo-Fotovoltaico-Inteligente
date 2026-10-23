import type { RegisteredJob } from '../runtime.js';
import { heartbeatJob } from './heartbeat.js';
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
];

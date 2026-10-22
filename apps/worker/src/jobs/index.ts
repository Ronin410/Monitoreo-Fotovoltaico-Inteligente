import type { RegisteredJob } from '../runtime.js';
import { heartbeatJob } from './heartbeat.js';

/** Jobs que atiende el worker. Cada fase agrega los suyos (ingesta, clima, métricas…). */
export const JOBS: RegisteredJob[] = [heartbeatJob];

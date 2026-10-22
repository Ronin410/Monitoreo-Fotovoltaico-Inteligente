import { defineJob } from '@pv/adapters';
import { z } from 'zod';
import { heartbeat } from '../heartbeat.js';
import { registerJob } from '../runtime.js';

/**
 * Latido del worker (specs/01 §Observabilidad). Pasa por cron, cola y job_runs, así el panel de
 * salud ve que todo el circuito funciona.
 */
export const workerHeartbeat = defineJob({
  name: 'worker.heartbeat',
  payload: z.object({}),
  scope: 'platform',
  retryLimit: 0,
  schedule: { cron: '*/5 * * * *' },
});

export const heartbeatJob = registerJob(workerHeartbeat, async (_payload, ctx) => {
  const beat = heartbeat(ctx.now());
  return { at: beat.at };
});

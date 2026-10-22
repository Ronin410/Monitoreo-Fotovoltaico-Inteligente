import { createWeatherProvider, JobQueue } from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient, UnsafeDatabaseRoleError } from '@pv/db';
import { pino } from 'pino';
import { JOBS } from './jobs/index.js';
import { startJobs } from './runtime.js';

const env = loadEnvOrExit();
const logger = pino({ base: { service: 'pv-worker' } });
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);

try {
  await assertAppRoleIsSafe(db);
} catch (err) {
  logger.fatal(
    err instanceof UnsafeDatabaseRoleError ? err.message : { err },
    'no se puede arrancar',
  );
  process.exit(1);
}

const queue = await JobQueue.start(env.SERVICE_DATABASE_URL);
queue.boss.on('error', (err: Error) => logger.error({ error_type: err.name }, 'error de pg-boss'));
await startJobs(JOBS, {
  db,
  serviceDb,
  queue,
  weather: createWeatherProvider(env),
  logger,
  now: () => new Date(),
});
logger.info({ jobs: JOBS.map((j) => j.definition.name) }, 'pv-worker atendiendo jobs');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'deteniendo pv-worker');
  await queue.stop();
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

import {
  createWeatherProvider,
  CredentialCipher,
  createAdapterRegistry,
  JobQueue,
} from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient } from '@pv/db';
import { pino } from 'pino';
import { DemoAlreadyExistsError, seedDemo } from '../seed/demo.js';
import { dbSimulatorSource } from '../simulator-source.js';

// pnpm db:seed:demo — siembra la demo de specs/04 §4 ejecutando el pipeline real. Las
// contraseñas se imprimen una sola vez en la consola y no se guardan en ningún archivo.

const env = loadEnvOrExit();
if (env.NODE_ENV === 'production') {
  console.error('La semilla de demo no se ejecuta con NODE_ENV=production.');
  process.exit(1);
}
const logger = pino({ level: 'warn', base: { service: 'pv-seed-demo' } });
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
await assertAppRoleIsSafe(db);
const queue = await JobQueue.start(env.SERVICE_DATABASE_URL, { supervise: false });

const started = Date.now();
try {
  console.error('Sembrando la demo (90 días de clima, telemetría y métricas)…');
  const result = await seedDemo({
    db,
    serviceDb,
    queue,
    weather: createWeatherProvider(env),
    cipher: CredentialCipher.fromEnv(env),
    adapters: (companyId) => createAdapterRegistry({ simulator: dbSimulatorSource(db, companyId) }),
    logger,
    now: () => new Date(),
  });
  for (const c of result.companies) {
    console.log(`Empresa ${c.slug}: ${c.plants} plantas, ${c.metricDays} días de métricas.`);
  }
  console.log('\nCredenciales de demo (no se guardan; cópialas ahora):');
  console.table(result.credentials);
  console.log(`Listo en ${Math.round((Date.now() - started) / 1000)} s.`);
} catch (err) {
  if (err instanceof DemoAlreadyExistsError) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await queue.stop();
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
}

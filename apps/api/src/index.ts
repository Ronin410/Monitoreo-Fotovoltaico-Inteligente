import { createEmailProvider, createStorageProvider } from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient, UnsafeDatabaseRoleError } from '@pv/db';
import { createApp } from './app.js';
import { createLogger } from './http/logger.js';

const env = loadEnvOrExit();
const logger = createLogger();
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);

// specs/02: la aplicación nunca debe conectarse con un rol que pueda saltarse RLS.
try {
  await assertAppRoleIsSafe(db);
} catch (err) {
  logger.fatal(
    err instanceof UnsafeDatabaseRoleError ? err.message : { err },
    'no se puede arrancar',
  );
  process.exit(1);
}

const port = env.PORT ?? 4000;
createApp({
  env,
  db,
  serviceDb,
  email: createEmailProvider(env),
  storage: createStorageProvider(env),
  logger,
}).listen(port, () => {
  logger.info({ port }, 'pv-api escuchando');
});

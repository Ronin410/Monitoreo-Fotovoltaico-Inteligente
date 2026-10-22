import { createEmailProvider } from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient } from '@pv/db';
import { createApp } from './app.js';
import { createLogger } from './http/logger.js';

const env = loadEnvOrExit();
const logger = createLogger();
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);

// specs/02: la aplicación nunca debe conectarse con un rol que pueda saltarse RLS.
await assertAppRoleIsSafe(db);

const port = env.PORT ?? 4000;
createApp({ env, db, serviceDb, email: createEmailProvider(env), logger }).listen(port, () => {
  logger.info({ port }, 'pv-api escuchando');
});

import { CredentialCipher } from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient } from '@pv/db';
import { rotateCredentials } from '../credentials-rotation.js';

// Uso (docs/respuesta-incidentes.md §Rotar la llave de credenciales):
//   CREDENTIALS_ENC_KEY=<nueva> CREDENTIALS_KEY_VERSION=<n+1> \
//   CREDENTIALS_PREVIOUS_KEYS="<n>:<anterior>" pnpm credentials:rotate

const env = loadEnvOrExit();
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
await assertAppRoleIsSafe(db);
const result = await rotateCredentials(db, serviceDb, CredentialCipher.fromEnv(env));
await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
console.log(JSON.stringify({ version: env.CREDENTIALS_KEY_VERSION, ...result }, null, 2));
if (result.missingKey > 0) {
  console.error(
    'Hay credenciales cifradas con una llave que no está en CREDENTIALS_PREVIOUS_KEYS; agréguela y vuelva a correr.',
  );
  process.exit(1);
}

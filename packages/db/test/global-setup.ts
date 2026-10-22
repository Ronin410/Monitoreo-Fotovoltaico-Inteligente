import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { testDatabaseUrl } from './test-db.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** Vacía la base de pruebas y aplica todas las migraciones antes de la suite. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

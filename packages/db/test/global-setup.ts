import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TEST_LOGIN_ROLES, testDatabaseUrl } from './test-db.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

async function withOwner(url: string, fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/** Vacía la base de pruebas, aplica las migraciones y crea los usuarios de conexión. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();

  await withOwner(url, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
    stdio: 'pipe',
  });

  // Los roles son de todo el servidor: se crean una vez y se reutilizan.
  await withOwner(url, async (client) => {
    for (const role of Object.values(TEST_LOGIN_ROLES)) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
        role.user,
      ]);
      if (rowCount === 0) {
        await client.query(
          `CREATE ROLE ${role.user} LOGIN PASSWORD '${role.password}' IN ROLE ${role.memberOf}`,
        );
      }
    }
  });
}

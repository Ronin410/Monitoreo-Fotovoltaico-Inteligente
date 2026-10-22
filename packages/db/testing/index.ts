import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Utilidades de pruebas de integración contra PostgreSQL real (specs/12).
// Cada proyecto de Vitest usa su propia base (<TEST_DATABASE_URL>_<sufijo>) porque el setup
// la vacía y los proyectos corren en paralelo.

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** Usuarios de conexión de prueba, miembros de los roles de grupo pv_app y pv_service. */
export const TEST_LOGIN_ROLES = {
  app: { user: 'pv_app_test', password: 'pv_app_test', memberOf: 'pv_app' },
  service: { user: 'pv_service_test', password: 'pv_service_test', memberOf: 'pv_service' },
} as const;

function baseUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      'Falta TEST_DATABASE_URL (por ejemplo postgres://postgres:postgres@localhost:5432/pv_iot_test).',
    );
  }
  const url = new URL(raw);
  const dbName = url.pathname.slice(1);
  if (!dbName.includes('test')) {
    throw new Error(`TEST_DATABASE_URL apunta a "${dbName}"; el nombre debe contener "test".`);
  }
  return url;
}

function urlFor(suffix: string, role?: { user: string; password: string }): string {
  if (!/^[a-z0-9_]+$/.test(suffix)) throw new Error(`Sufijo de base inválido: ${suffix}`);
  const url = baseUrl();
  url.pathname = `/${url.pathname.slice(1)}_${suffix}`;
  if (role) {
    url.username = role.user;
    url.password = role.password;
  }
  return url.toString();
}

/** Conexión con el rol dueño (migraciones y siembra de datos sin RLS). */
export const testDatabaseUrl = (suffix: string) => urlFor(suffix);

/** Conexión como la aplicación (pv_app: sin BYPASSRLS ni dueño de tablas). */
export const testAppDatabaseUrl = (suffix: string) => urlFor(suffix, TEST_LOGIN_ROLES.app);

/** Conexión como el rol de plataforma (pv_service). */
export const testServiceDatabaseUrl = (suffix: string) => urlFor(suffix, TEST_LOGIN_ROLES.service);

async function withClient(url: string, fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Crea (si hace falta) y vacía la base de pruebas del proyecto, aplica todas las migraciones
 * y crea los usuarios de conexión. Para el globalSetup de Vitest.
 */
export async function prepareTestDatabase(suffix: string): Promise<void> {
  const url = testDatabaseUrl(suffix);
  const dbName = new URL(url).pathname.slice(1);

  await withClient(baseUrl().toString(), async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  });

  await withClient(url, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
    stdio: 'pipe',
  });

  // Los roles son de todo el servidor: se crean una vez y se reutilizan.
  await withClient(url, async (client) => {
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

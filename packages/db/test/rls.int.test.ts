import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertAppRoleIsSafe,
  createPrismaClient,
  TenantViolationError,
  UnsafeDatabaseRoleError,
  withTenant,
  type PrismaClient,
  type TENANT_MODELS,
} from '../src/index.js';
import { testAppDatabaseUrl, testDatabaseUrl, testServiceDatabaseUrl } from './test-db.js';

// Tabla de cada modelo con company_id (debe coincidir con @@map del esquema).
const MODEL_TABLE: Record<(typeof TENANT_MODELS)[number], string> = {
  Invitation: 'invitations',
  Client: 'clients',
  SolarPlant: 'solar_plants',
  InverterCredential: 'inverter_credentials',
  TelemetryReading: 'telemetry_readings',
  PlantWeatherHourly: 'plant_weather_hourly',
  PlantDailyMetric: 'plant_daily_metrics',
  PlantEvent: 'plant_events',
  Alert: 'alerts',
  MaintenanceTicket: 'maintenance_tickets',
  Notification: 'notifications',
  MonthlyReport: 'monthly_reports',
  AiConversation: 'ai_conversations',
  AiMessage: 'ai_messages',
  AiUsageMonthly: 'ai_usage_monthly',
  User: 'users',
  AuditLog: 'audit_log',
  JobRun: 'job_runs',
};
const TENANT_TABLES = Object.values(MODEL_TABLE);

let owner: PrismaClient;
let app: PrismaClient;
let appPool: pg.Pool;
let servicePool: pg.Pool;

type Seeded = Awaited<ReturnType<typeof seedCompany>>;
let A: Seeded;
let B: Seeded;

/** Siembra una empresa con datos en las tablas principales (como dueño, sin RLS). */
async function seedCompany(tag: string) {
  const company = await owner.company.create({
    data: { name: `Empresa ${tag}`, slug: `rls-${tag}-${Date.now()}` },
  });
  const companyId = company.id;
  const user = await owner.user.create({
    data: {
      companyId,
      email: `admin-${tag}-${Date.now()}@example.com`,
      name: 'Admin',
      role: 'company_admin',
    },
  });
  const client = await owner.client.create({
    data: {
      companyId,
      name: `Cliente ${tag}`,
      address: 'Calle 1',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const plant = await owner.solarPlant.create({
    data: {
      companyId,
      clientId: client.id,
      name: `Planta ${tag}`,
      capacityKwp: 5,
      tiltDeg: 20,
      azimuthDeg: 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
    },
  });
  await owner.telemetryReading.create({
    data: { companyId, plantId: plant.id, ts: new Date(), powerKw: 3, energyKwh: 0.75 },
  });
  await owner.alert.create({
    data: { companyId, plantId: plant.id, type: 'soiling', severity: 'warning' },
  });
  await owner.auditLog.create({ data: { companyId, userId: user.id, action: 'login' } });
  await owner.aiUsageMonthly.create({
    data: { companyId, period: '2026-10', feature: 'chat', requests: 1 },
  });
  return { companyId, userId: user.id, clientId: client.id, plantId: plant.id };
}

/** Ejecuta consultas como pv_app en una transacción con app.company_id fijado (o sin fijar). */
async function asApp<T>(
  companyId: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    if (companyId) await c.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    const result = await fn(c);
    await c.query('ROLLBACK');
    return result;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

async function pgError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
}

beforeAll(async () => {
  owner = createPrismaClient(testDatabaseUrl());
  app = createPrismaClient(testAppDatabaseUrl());
  appPool = new pg.Pool({ connectionString: testAppDatabaseUrl(), max: 2 });
  servicePool = new pg.Pool({ connectionString: testServiceDatabaseUrl(), max: 2 });
  A = await seedCompany('a');
  B = await seedCompany('b');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), appPool.end(), servicePool.end()]);
});

describe('catálogo de RLS', () => {
  it('TENANT_MODELS cubre exactamente las tablas con company_id', async () => {
    const rows = await owner.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([...TENANT_TABLES].sort());
  });

  it('toda tabla con company_id, y companies, tiene RLS activado y forzado con política', async () => {
    const rows = await owner.$queryRaw<{ table: string; rls: boolean; forced: boolean }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const policies = await owner.$queryRaw<{ table: string; roles: string[] }[]>`
      SELECT tablename AS table, roles::text[] AS roles FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'tenant_isolation'`;
    const byTable = Object.fromEntries(rows.map((r) => [r.table, r]));
    const policyRoles = Object.fromEntries(policies.map((p) => [p.table, p.roles]));
    for (const table of [...TENANT_TABLES, 'companies']) {
      expect(byTable[table], table).toMatchObject({ rls: true, forced: true });
      expect(policyRoles[table], table).toEqual(['pv_app']);
    }
  });

  it('el rol pv_app no tiene BYPASSRLS, no es superusuario ni dueño de tablas', async () => {
    await expect(assertAppRoleIsSafe(app)).resolves.toBeUndefined();
    const [role] = await owner.$queryRaw<{ bypass: boolean; superuser: boolean }[]>`
      SELECT rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = 'pv_app'`;
    expect(role).toEqual({ bypass: false, superuser: false });
  });

  it('assertAppRoleIsSafe rechaza una conexión con superusuario o dueño de tablas', async () => {
    await expect(assertAppRoleIsSafe(owner)).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
  });
});

describe('RLS (capa 2): consultas directas como pv_app', () => {
  it('CA F1-T2: con app.company_id de A, consultar datos de B devuelve 0 filas', async () => {
    await asApp(A.companyId, async (c) => {
      for (const table of TENANT_TABLES) {
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE company_id = $1`,
          [B.companyId],
        );
        expect(rows[0].n, table).toBe(0);
      }
      const plant = await c.query('SELECT * FROM solar_plants WHERE id = $1', [B.plantId]);
      expect(plant.rowCount).toBe(0);
      const company = await c.query('SELECT * FROM companies WHERE id = $1', [B.companyId]);
      expect(company.rowCount).toBe(0);
    });
  });

  it('con app.company_id de A sí ve los datos de A', async () => {
    await asApp(A.companyId, async (c) => {
      for (const table of ['clients', 'solar_plants', 'telemetry_readings', 'alerts', 'users']) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0].n, table).toBeGreaterThan(0);
      }
      const { rows } = await c.query('SELECT DISTINCT company_id FROM solar_plants');
      expect(rows).toEqual([{ company_id: A.companyId }]);
    });
  });

  it('sin app.company_id no ve ninguna fila (falla cerrado)', async () => {
    await asApp(null, async (c) => {
      for (const table of [...TENANT_TABLES, 'companies']) {
        const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it('app.company_id no sobrevive a la transacción', async () => {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.company_id', $1, true)", [A.companyId]);
      await c.query('COMMIT');
      const { rows } = await c.query('SELECT count(*)::int AS n FROM solar_plants');
      expect(rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('no puede insertar, modificar ni borrar datos de B', async () => {
    await asApp(A.companyId, async (c) => {
      await c.query('SAVEPOINT s');
      const insert = await pgError(() =>
        c.query(
          `INSERT INTO plant_events (company_id, plant_id, type, occurred_at, source)
           VALUES ($1, $2, 'note', now(), 'manual')`,
          [B.companyId, B.plantId],
        ),
      );
      expect(insert).toBe('42501'); // violación de la política WITH CHECK
      await c.query('ROLLBACK TO SAVEPOINT s');

      const update = await c.query("UPDATE solar_plants SET name = 'hackeada' WHERE id = $1", [
        B.plantId,
      ]);
      expect(update.rowCount).toBe(0);
      const del = await c.query('DELETE FROM telemetry_readings WHERE company_id = $1', [
        B.companyId,
      ]);
      expect(del.rowCount).toBe(0);

      // Tampoco puede mover una fila propia a la empresa B.
      await c.query('SAVEPOINT s2');
      const move = await pgError(() =>
        c.query('UPDATE clients SET company_id = $1 WHERE id = $2', [B.companyId, A.clientId]),
      );
      expect(move).toBe('42501');
      await c.query('ROLLBACK TO SAVEPOINT s2');
    });
    const [plantB] = await owner.$queryRaw<{ name: string }[]>`
      SELECT name FROM solar_plants WHERE id = ${B.plantId}::uuid`;
    expect(plantB?.name).toBe('Planta b');
  });

  it('respeta los permisos de tabla: sin crear empresas, borrar usuarios ni editar auditoría', async () => {
    await asApp(A.companyId, async (c) => {
      for (const sql of [
        "INSERT INTO companies (name, slug) VALUES ('X', 'x')",
        'DELETE FROM users',
        "UPDATE audit_log SET action = 'otra'",
        'DELETE FROM audit_log',
        'SELECT * FROM _prisma_migrations',
      ]) {
        await c.query('SAVEPOINT s');
        expect(await pgError(() => c.query(sql)), sql).toBe('42501');
        await c.query('ROLLBACK TO SAVEPOINT s');
      }
    });
  });
});

describe('rol de plataforma pv_service', () => {
  it('ve empresas y usuarios de todas las empresas', async () => {
    const { rows } = await servicePool.query(
      'SELECT count(*)::int AS n FROM companies WHERE id = ANY($1)',
      [[A.companyId, B.companyId]],
    );
    expect(rows[0].n).toBe(2);
  });

  it('puede contar plantas pero no leer datos operativos', async () => {
    const { rows } = await servicePool.query(
      'SELECT count(*)::int AS n FROM solar_plants WHERE company_id = $1',
      [A.companyId],
    );
    expect(rows[0].n).toBe(1);
    for (const table of ['clients', 'telemetry_readings', 'alerts', 'plant_daily_metrics']) {
      expect(await pgError(() => servicePool.query(`SELECT 1 FROM ${table}`)), table).toBe('42501');
    }
  });
});

describe('withTenant (capa 1 + capa 2)', () => {
  it('solo devuelve datos de la empresa de la sesión', async () => {
    const plants = await withTenant(app, A.companyId, (tx) => tx.solarPlant.findMany());
    expect(plants.map((p) => p.id)).toEqual([A.plantId]);

    const users = await withTenant(app, A.companyId, (tx) => tx.user.findMany());
    expect(users.map((u) => u.id)).toEqual([A.userId]);

    const company = await withTenant(app, A.companyId, (tx) => tx.company.findMany());
    expect(company.map((c) => c.id)).toEqual([A.companyId]);
  });

  it('un recurso de otra empresa no existe (para responder 404)', async () => {
    const plant = await withTenant(app, A.companyId, (tx) =>
      tx.solarPlant.findUnique({ where: { id: B.plantId } }),
    );
    expect(plant).toBeNull();

    const count = await withTenant(app, A.companyId, (tx) =>
      tx.alert.count({ where: { plantId: B.plantId } }),
    );
    expect(count).toBe(0);

    await expect(
      withTenant(app, A.companyId, (tx) =>
        tx.solarPlant.update({ where: { id: B.plantId }, data: { name: 'x' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('agrega company_id al crear', async () => {
    const event = await withTenant(app, A.companyId, (tx) =>
      tx.plantEvent.create({
        data: {
          plantId: A.plantId,
          type: 'note',
          occurredAt: new Date(),
          source: 'manual',
        } as never,
      }),
    );
    expect(event.companyId).toBe(A.companyId);
  });

  it('rechaza un company_id distinto en where o data', async () => {
    await expect(
      withTenant(app, A.companyId, (tx) =>
        tx.solarPlant.findMany({ where: { companyId: B.companyId } }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);

    await expect(
      withTenant(app, A.companyId, (tx) =>
        tx.plantEvent.create({
          data: {
            companyId: B.companyId,
            plantId: B.plantId,
            type: 'note',
            occurredAt: new Date(),
            source: 'manual',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);

    await expect(
      withTenant(app, A.companyId, (tx) =>
        tx.client.update({ where: { id: A.clientId }, data: { companyId: B.companyId } }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('no permite crear ni borrar empresas', async () => {
    await expect(
      withTenant(app, A.companyId, (tx) =>
        tx.company.create({ data: { name: 'X', slug: `x-${Date.now()}` } }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      withTenant(app, A.companyId, (tx) => tx.company.delete({ where: { id: A.companyId } })),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('el SQL crudo dentro de withTenant sigue limitado por RLS', async () => {
    const rows = await withTenant(
      app,
      A.companyId,
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM solar_plants`,
    );
    expect(rows.map((r) => r.id)).toEqual([A.plantId]);
  });

  it('valida que companyId sea un UUID antes de consultar', async () => {
    await expect(withTenant(app, "' OR 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it('una empresa inexistente no ve nada', async () => {
    const plants = await withTenant(app, '00000000-0000-4000-8000-000000000000', (tx) =>
      tx.solarPlant.findMany(),
    );
    expect(plants).toEqual([]);
  });

  it('el cliente sin withTenant no ve datos', async () => {
    expect(await app.solarPlant.findMany()).toEqual([]);
  });
});

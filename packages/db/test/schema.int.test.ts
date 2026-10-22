import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index.js';
import { testDatabaseUrl } from './test-db.js';

// Tablas de specs/03. Las marcadas 🔒 deben tener company_id NOT NULL.
const TENANT_TABLES = [
  'invitations',
  'clients',
  'solar_plants',
  'inverter_credentials',
  'telemetry_readings',
  'plant_weather_hourly',
  'plant_daily_metrics',
  'plant_events',
  'alerts',
  'maintenance_tickets',
  'notifications',
  'monthly_reports',
  'ai_conversations',
  'ai_messages',
  'ai_usage_monthly',
];
const PLATFORM_TABLES = ['companies', 'users', 'refresh_tokens', 'audit_log', 'job_runs'];

let db: PrismaClient;

beforeAll(() => {
  db = createPrismaClient(testDatabaseUrl());
});

afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
async function createPlant() {
  seq += 1;
  const company = await db.company.create({
    data: { name: `Empresa ${seq}`, slug: `empresa-${seq}-${Date.now()}` },
  });
  const client = await db.client.create({
    data: {
      companyId: company.id,
      name: `Cliente ${seq}`,
      address: 'Calle 1',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const plant = await db.solarPlant.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: `Planta ${seq}`,
      capacityKwp: 5,
      tiltDeg: 20,
      azimuthDeg: 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
    },
  });
  return { company, client, plant };
}

type DriverCause = { originalCode?: string; originalMessage?: string };

/**
 * Ejecuta la operación y devuelve "código:restricción" de la violación de PostgreSQL
 * (por ejemplo "23514:solar_plants_capacity_positive"), o null si no falló.
 */
async function violation(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const cause = (err as { meta?: { driverAdapterError?: { cause?: DriverCause } } }).meta
      ?.driverAdapterError?.cause;
    if (!cause?.originalCode) throw err;
    const constraint = /constraint "([^"]+)"/.exec(cause.originalMessage ?? '')?.[1];
    return `${cause.originalCode}:${constraint ?? '?'}`;
  }
}

describe('esquema (F1-T1)', () => {
  it('crea todas las tablas de specs/03', async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining([...TENANT_TABLES, ...PLATFORM_TABLES]));
  });

  it('las tablas 🔒 tienen company_id NOT NULL', async () => {
    const rows = await db.$queryRaw<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id'`;
    const nullability = Object.fromEntries(rows.map((r) => [r.table_name, r.is_nullable]));
    for (const table of TENANT_TABLES) {
      expect(nullability[table], table).toBe('NO');
    }
    expect(nullability.audit_log).toBe('YES');
  });

  it('crea índices BRIN sobre ts en las series de tiempo', async () => {
    const rows = await db.$queryRaw<{ tablename: string; indexdef: string }[]>`
      SELECT tablename, indexdef FROM pg_indexes WHERE indexdef ILIKE '%USING brin%'`;
    expect(rows.map((r) => r.tablename).sort()).toEqual([
      'plant_weather_hourly',
      'telemetry_readings',
    ]);
  });

  it('permite solo una alerta abierta por planta y tipo', async () => {
    const { company, plant } = await createPlant();
    const base = { companyId: company.id, plantId: plant.id, severity: 'warning' as const };

    const first = await db.alert.create({ data: { ...base, type: 'soiling' } });
    expect(await violation(() => db.alert.create({ data: { ...base, type: 'soiling' } }))).toBe(
      '23505:alerts_one_open_per_plant_type',
    );

    // Reconocida sigue contando como abierta.
    await db.alert.update({ where: { id: first.id }, data: { status: 'acknowledged' } });
    expect(await violation(() => db.alert.create({ data: { ...base, type: 'soiling' } }))).toBe(
      '23505:alerts_one_open_per_plant_type',
    );

    // Otro tipo sí se permite; y al resolver la primera se puede abrir otra del mismo tipo.
    await db.alert.create({ data: { ...base, type: 'sudden_drop' } });
    await db.alert.update({
      where: { id: first.id },
      data: { status: 'resolved', resolution: 'auto', resolvedAt: new Date() },
    });
    await db.alert.create({ data: { ...base, type: 'soiling' } });
  });

  it('exige motivo al descartar una alerta', async () => {
    const { company, plant } = await createPlant();
    const alert = await db.alert.create({
      data: { companyId: company.id, plantId: plant.id, type: 'offline', severity: 'critical' },
    });
    expect(
      await violation(() =>
        db.alert.update({ where: { id: alert.id }, data: { status: 'dismissed' } }),
      ),
    ).toBe('23514:alerts_dismiss_reason_required');
  });

  it('impide que una fila apunte a una planta de otra empresa (FK compuesta)', async () => {
    const a = await createPlant();
    const b = await createPlant();
    const code = await violation(() =>
      db.telemetryReading.create({
        data: {
          companyId: b.company.id,
          plantId: a.plant.id,
          ts: new Date('2026-10-01T18:00:00Z'),
          powerKw: 3,
          energyKwh: 0.75,
        },
      }),
    );
    expect(code).toBe('23503:telemetry_readings_plant_id_company_id_fkey');
  });

  it('impide una planta con cliente de otra empresa', async () => {
    const a = await createPlant();
    const b = await createPlant();
    const code = await violation(() =>
      db.solarPlant.create({
        data: {
          companyId: b.company.id,
          clientId: a.client.id,
          name: 'Cruzada',
          capacityKwp: 5,
          tiltDeg: 20,
          azimuthDeg: 180,
          inverterBrand: 'simulator',
          postalCode: '80000',
          colonia: 'Centro',
        },
      }),
    );
    expect(code).toBe('23503:solar_plants_client_id_company_id_fkey');
  });

  it('valida reglas de dominio con CHECK', async () => {
    const { company, client } = await createPlant();
    const plant = (over: Record<string, unknown>) =>
      db.solarPlant.create({
        data: {
          companyId: company.id,
          clientId: client.id,
          name: 'X',
          capacityKwp: 5,
          tiltDeg: 20,
          azimuthDeg: 180,
          inverterBrand: 'simulator',
          postalCode: '80000',
          colonia: 'Centro',
          ...over,
        },
      });
    expect(await violation(() => plant({ capacityKwp: 0 }))).toBe(
      '23514:solar_plants_capacity_positive',
    );
    expect(await violation(() => plant({ tiltDeg: 95 }))).toBe('23514:solar_plants_tilt_range');
    expect(await violation(() => plant({ azimuthDeg: 361 }))).toBe(
      '23514:solar_plants_azimuth_range',
    );
    expect(await violation(() => plant({ gammaPctPerC: 0.4 }))).toBe(
      '23514:solar_plants_gamma_negative',
    );
    expect(await violation(() => plant({ postalCode: '8000' }))).toBe(
      '23514:solar_plants_postal_code_5_digits',
    );
    expect(
      await violation(() =>
        plant({ inverterBrand: 'goodwe', simulationProfile: { seed: 1, scenarios: [] } }),
      ),
    ).toBe('23514:solar_plants_simulation_profile_only_simulator');

    expect(
      await violation(() =>
        db.user.create({
          data: { email: 'Admin@Example.com', name: 'A', role: 'superadmin' },
        }),
      ),
    ).toBe('23514:users_email_lowercase');
    expect(
      await violation(() =>
        db.user.create({
          data: { email: 'root@example.com', name: 'A', role: 'superadmin', companyId: company.id },
        }),
      ),
    ).toBe('23514:users_company_required_unless_superadmin');
    expect(
      await violation(() =>
        db.user.create({ data: { email: 'op@example.com', name: 'A', role: 'operator' } }),
      ),
    ).toBe('23514:users_company_required_unless_superadmin');
    expect(
      await violation(() =>
        db.monthlyReport.create({
          data: { companyId: company.id, clientId: client.id, period: '2026-13' },
        }),
      ),
    ).toBe('23514:monthly_reports_period_format');
  });

  it('aplica los valores por defecto de la empresa', async () => {
    const company = await db.company.create({ data: { name: 'D', slug: `d-${Date.now()}` } });
    expect(company.brandColor).toBe('#F59E0B');
    expect(company.timezone).toBe('America/Mazatlan');
    expect(company.status).toBe('active');
    expect(company.aiMonthlyTokenBudget).toBe(2_000_000);
  });
});

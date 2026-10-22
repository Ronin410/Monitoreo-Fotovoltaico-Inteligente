import { JobQueue, SyntheticWeatherProvider, type WeatherProvider } from '@pv/adapters';
import { createPrismaClient, type PrismaClient } from '@pv/db';
import { testAppDatabaseUrl, testDatabaseUrl, testServiceDatabaseUrl } from '@pv/db/testing';
import { pino } from 'pino';
import type { JobContext, RuntimeDeps } from '../src/runtime.js';

export type WorkerTestContext = Awaited<ReturnType<typeof createWorkerTestContext>>;

export async function createWorkerTestContext(
  weather: WeatherProvider = new SyntheticWeatherProvider(),
) {
  const owner = createPrismaClient(testDatabaseUrl('worker'));
  const db = createPrismaClient(testAppDatabaseUrl('worker'));
  const serviceDb = createPrismaClient(testServiceDatabaseUrl('worker'));
  const queue = await JobQueue.start(testServiceDatabaseUrl('worker'), {
    pollingIntervalSeconds: 0.5,
    supervise: false,
  });
  let now = new Date('2026-10-21T19:00:00Z');
  const deps: RuntimeDeps = {
    db,
    serviceDb,
    queue,
    weather,
    logger: pino({ level: 'silent' }),
    now: () => now,
  };
  return {
    owner,
    db,
    serviceDb,
    queue,
    deps,
    setNow: (d: Date) => {
      now = d;
    },
    /** Contexto de un job de la empresa, para llamar funciones de jobs directamente. */
    jobContext: (companyId: string | null): JobContext => ({
      ...deps,
      companyId,
      attempt: 0,
      log: deps.logger,
    }),
    close: async () => {
      await queue.stop();
      await Promise.all([owner.$disconnect(), db.$disconnect(), serviceDb.$disconnect()]);
    },
  };
}

let seq = 0;

export async function createCompanyWithClient(
  owner: PrismaClient,
  over: { status?: 'active' | 'suspended'; timezone?: string } = {},
) {
  seq += 1;
  const company = await owner.company.create({
    data: { name: `Empresa ${seq}`, slug: `wk-${Date.now()}-${seq}`, ...over },
  });
  const client = await owner.client.create({
    data: {
      companyId: company.id,
      name: 'Cliente',
      address: 'x',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  return { company, client };
}

export function createPlant(
  owner: PrismaClient,
  companyId: string,
  clientId: string,
  over: Partial<{
    lat: number | null;
    lon: number | null;
    tiltDeg: number;
    azimuthDeg: number;
    status: 'active' | 'paused' | 'decommissioned';
    deletedAt: Date | null;
  }> = {},
) {
  seq += 1;
  return owner.solarPlant.create({
    data: {
      companyId,
      clientId,
      name: `Planta ${seq}`,
      capacityKwp: 5,
      tiltDeg: over.tiltDeg ?? 20,
      azimuthDeg: over.azimuthDeg ?? 180,
      inverterBrand: 'simulator',
      postalCode: '80000',
      colonia: 'Centro',
      lat: over.lat === undefined ? 24.8 : over.lat,
      lon: over.lon === undefined ? -107.39 : over.lon,
      status: over.status ?? 'active',
      deletedAt: over.deletedAt ?? null,
    },
  });
}

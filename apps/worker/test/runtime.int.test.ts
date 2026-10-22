import { companyPayload, defineJob, JobQueue } from '@pv/adapters';
import { createPrismaClient, withTenant, type PrismaClient } from '@pv/db';
import { testAppDatabaseUrl, testDatabaseUrl, testServiceDatabaseUrl } from '@pv/db/testing';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerJob, runJob, startJobs, type RuntimeDeps } from '../src/runtime.js';

let owner: PrismaClient;
let db: PrismaClient;
let serviceDb: PrismaClient;
let queue: JobQueue;
let deps: RuntimeDeps;

beforeAll(async () => {
  owner = createPrismaClient(testDatabaseUrl('worker'));
  db = createPrismaClient(testAppDatabaseUrl('worker'));
  serviceDb = createPrismaClient(testServiceDatabaseUrl('worker'));
  queue = await JobQueue.start(testServiceDatabaseUrl('worker'), {
    pollingIntervalSeconds: 0.5,
    supervise: false,
  });
  deps = { db, serviceDb, queue, logger: pino({ level: 'silent' }), now: () => new Date() };
});

afterAll(async () => {
  await queue.stop();
  await Promise.all([owner.$disconnect(), db.$disconnect(), serviceDb.$disconnect()]);
});

let seq = 0;
async function companyWithPlant(status: 'active' | 'suspended' = 'active') {
  seq += 1;
  const company = await owner.company.create({
    data: { name: `E${seq}`, slug: `w-${Date.now()}-${seq}`, status },
  });
  const client = await owner.client.create({
    data: {
      companyId: company.id,
      name: 'C',
      address: 'x',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  const plant = await owner.solarPlant.create({
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
  return { company, plant };
}

const runsOf = (jobName: string) =>
  owner.jobRun.findMany({ where: { jobName }, orderBy: { createdAt: 'asc' } });

async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (done(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Job de prueba que cuenta las plantas visibles dentro de su empresa. */
const countPlants = defineJob({
  name: 'test.count_plants',
  payload: companyPayload,
  scope: 'company',
});
const countPlantsJob = registerJob(countPlants, async (payload, ctx) => {
  const plants = await withTenant(ctx.db, payload.company_id, (tx) => tx.solarPlant.findMany());
  return { plants: plants.length, plant_ids: plants.map((p) => p.id) };
});

describe('runJob', () => {
  it('ejecuta dentro de la empresa y registra el éxito con sus estadísticas', async () => {
    const a = await companyWithPlant();
    await companyWithPlant(); // empresa B: el job de A no debe ver su planta
    const outcome = await runJob(countPlantsJob, { company_id: a.company.id }, 0, deps);
    expect(outcome).toBe('succeeded');
    const [run] = await owner.jobRun.findMany({
      where: { jobName: 'test.count_plants', companyId: a.company.id },
    });
    expect(run).toMatchObject({ status: 'succeeded', error: null });
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.stats).toEqual({ attempt: 0, plants: 1, plant_ids: [a.plant.id] });
  });

  it('una empresa suspendida no ejecuta el job: queda omitido', async () => {
    const s = await companyWithPlant('suspended');
    expect(await runJob(countPlantsJob, { company_id: s.company.id }, 0, deps)).toBe('skipped');
    const [run] = await owner.jobRun.findMany({ where: { companyId: s.company.id } });
    expect(run).toMatchObject({
      status: 'skipped',
      stats: { attempt: 0, reason: 'company_suspended' },
    });
  });

  it('un payload inválido se registra como fallido y no se reintenta', async () => {
    expect(await runJob(countPlantsJob, { company_id: 'no-es-uuid' }, 0, deps)).toBe('invalid');
    expect(await runJob(countPlantsJob, {}, 0, deps)).toBe('invalid');
    const runs = await owner.jobRun.findMany({
      where: { jobName: 'test.count_plants', error: 'invalid_payload' },
    });
    expect(runs).toHaveLength(2);
  });

  it('un error del job se registra y se relanza para que pg-boss reintente', async () => {
    const def = defineJob({ name: 'test.always_fails', payload: z.object({}), scope: 'platform' });
    const job = registerJob(def, async () => {
      throw new TypeError('algo salió mal');
    });
    await expect(runJob(job, {}, 2, deps)).rejects.toThrow('algo salió mal');
    const [run] = await runsOf('test.always_fails');
    expect(run).toMatchObject({
      status: 'failed',
      companyId: null,
      error: 'TypeError: algo salió mal',
      stats: { attempt: 2 },
    });
  });
});

describe('con pg-boss', () => {
  it('reintenta un job fallido con backoff y registra cada intento', async () => {
    let calls = 0;
    const def = defineJob({
      name: 'test.flaky',
      payload: companyPayload,
      scope: 'company',
      retryLimit: 2,
      retryDelaySeconds: 1,
    });
    const job = registerJob(def, async () => {
      calls += 1;
      if (calls === 1) throw new Error('falla temporal del proveedor');
      return { calls };
    });
    await startJobs([job], deps);
    const { company } = await companyWithPlant();
    expect(await queue.enqueue(def, { company_id: company.id })).toEqual(expect.any(String));

    const runs = await waitFor(
      () => runsOf('test.flaky'),
      (r) => r.some((x) => x.status === 'succeeded'),
    );
    expect(runs.map((r) => [r.status, (r.stats as { attempt: number }).attempt])).toEqual([
      ['failed', 0],
      ['succeeded', 1],
    ]);
    expect(runs.every((r) => r.companyId === company.id)).toBe(true);
  });

  it('valida el payload al encolar', async () => {
    await expect(queue.enqueue(countPlants, { company_id: 'x' } as never)).rejects.toThrow();
  });

  it('no encola dos veces el mismo trabajo pendiente (singletonKey)', async () => {
    const def = defineJob({
      name: 'test.unique',
      payload: companyPayload.extend({ date: z.iso.date() }),
      scope: 'company',
      singletonKey: (p) => `test.unique:${p.company_id}:${p.date}`,
    });
    await queue.ensureQueue(def);
    const { company } = await companyWithPlant();
    const payload = { company_id: company.id, date: '2026-10-22' };
    expect(await queue.enqueue(def, payload)).toEqual(expect.any(String));
    expect(await queue.enqueue(def, payload)).toBeNull();
    // Otra fecha es otro trabajo.
    expect(await queue.enqueue(def, { ...payload, date: '2026-10-23' })).toEqual(
      expect.any(String),
    );
  });
});

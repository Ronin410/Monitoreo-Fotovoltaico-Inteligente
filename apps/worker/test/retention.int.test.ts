import { telemetryCleanupCompany } from '@pv/adapters';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricsRecomputeJob } from '../src/jobs/metrics.js';
import { cleanupCompanyTelemetry, telemetryCleanupJob } from '../src/jobs/retention.js';
import { runJob } from '../src/runtime.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

// F10-T2 (specs/03): las lecturas de 15 min de más de 13 meses se borran; las métricas diarias se
// conservan siempre y un recálculo nunca las pisa con días ya limpiados.

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  await ctx.queue.ensureQueue(telemetryCleanupCompany);
  // 24 de octubre de 2026 en Mazatlán: se conserva desde el 24 de septiembre de 2025.
  ctx.setNow(new Date('2026-10-24T18:00:00Z'));
});
afterAll(() => ctx.close());

/** 00:00 locales de Mazatlán (UTC-7) del día. */
const local = (day: string, hour = 0) =>
  new Date(`${day}T${String(hour + 7).padStart(2, '0')}:00:00Z`);

async function fixture() {
  const c = await createCompanyWithClient(ctx.owner);
  const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
  const deleted = await createPlant(ctx.owner, c.company.id, c.client.id, {
    deletedAt: new Date('2026-01-01T00:00:00Z'),
  });
  const reading = (plantId: string, ts: Date) => ({
    companyId: c.company.id,
    plantId,
    ts,
    powerKw: 3,
    energyKwh: 0.75,
  });
  await ctx.owner.telemetryReading.createMany({
    data: [
      reading(plant.id, local('2025-06-01', 12)),
      reading(plant.id, local('2025-09-23', 16)),
      // Primer instante que se conserva y uno reciente.
      reading(plant.id, local('2025-09-24')),
      reading(plant.id, local('2026-10-23', 12)),
      reading(deleted.id, local('2025-08-01', 12)),
    ],
  });
  await ctx.owner.plantDailyMetric.create({
    data: {
      companyId: c.company.id,
      plantId: plant.id,
      date: new Date('2025-06-01T00:00:00Z'),
      clientId: c.client.id,
      postalCode: '80000',
      colonia: 'Centro',
      energyKwh: 31.5,
      irradiationPoaKwhM2: 6,
      expectedStcKwh: 38,
      expectedTempKwh: 35,
      specificYieldKwhKwp: 6.3,
      isValidDay: true,
      status: 'ok',
    },
  });
  return { ...c, plant, deleted };
}

const readingsOf = async (companyId: string) =>
  (await ctx.owner.telemetryReading.findMany({ where: { companyId }, orderBy: { ts: 'asc' } })).map(
    (r) => r.ts.toISOString(),
  );

describe('telemetry.cleanup', () => {
  it('borra las lecturas de más de 13 meses y conserva lo demás', async () => {
    const a = await fixture();
    const b = await fixture();
    const before = await readingsOf(b.company.id);

    expect(await cleanupCompanyTelemetry(ctx.jobContext(a.company.id), a.company.id)).toEqual({
      keep_from: '2025-09-24',
      plants: 2,
      deleted: 3,
    });
    expect(await readingsOf(a.company.id)).toEqual([
      local('2025-09-24').toISOString(),
      local('2026-10-23', 12).toISOString(),
    ]);
    // Las métricas diarias se conservan siempre; otra empresa no se toca.
    expect(await ctx.owner.plantDailyMetric.count({ where: { plantId: a.plant.id } })).toBe(1);
    expect(await readingsOf(b.company.id)).toEqual(before);

    // Idempotente.
    expect(await cleanupCompanyTelemetry(ctx.jobContext(a.company.id), a.company.id)).toMatchObject(
      { deleted: 0 },
    );
  });

  it('el orquestador encola la limpieza de las empresas activas', async () => {
    await fixture();
    const res = await telemetryCleanupJob.handler({}, ctx.jobContext(null));
    expect((res as { enqueued: number }).enqueued).toBeGreaterThan(0);
  });

  it('un recálculo no pisa las métricas de días ya limpiados', async () => {
    const a = await fixture();
    await cleanupCompanyTelemetry(ctx.jobContext(a.company.id), a.company.id);
    expect(
      await runJob(
        metricsRecomputeJob,
        { company_id: a.company.id, from: '2025-06-01', to: '2025-06-03' },
        0,
        ctx.deps,
      ),
    ).toBe('succeeded');
    const metric = await ctx.owner.plantDailyMetric.findFirst({
      where: { plantId: a.plant.id, date: new Date('2025-06-01T00:00:00Z') },
    });
    expect(metric?.energyKwh.toNumber()).toBe(31.5);
    const [run] = await ctx.owner.jobRun.findMany({
      where: { jobName: 'metrics.recompute', companyId: a.company.id, status: 'succeeded' },
    });
    expect(run?.stats).toMatchObject({ days: 0, skipped_before: '2025-09-24' });
  });
});

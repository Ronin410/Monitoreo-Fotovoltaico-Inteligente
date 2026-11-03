import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measureCompanyUsage } from '../src/costs-usage.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

// Consumo por empresa para la hoja de costos (docs/costos.md).

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
});
afterAll(() => ctx.close());

const now = new Date('2026-11-03T18:00:00Z');
const options = {
  period: '2026-10',
  days: 10,
  models: { chat: 'modelo-chat', fast: 'modelo-rapido' },
  reportPdfKb: 100,
};

describe('consumo por empresa', () => {
  it('cuenta plantas, lecturas, correos, archivos y tokens de cada empresa por separado', async () => {
    const a = await createCompanyWithClient(ctx.owner);
    const b = await createCompanyWithClient(ctx.owner);
    const plant = await createPlant(ctx.owner, a.company.id, a.client.id);
    await createPlant(ctx.owner, a.company.id, a.client.id, { deletedAt: new Date() });
    await createPlant(ctx.owner, b.company.id, b.client.id);
    // 20 lecturas en la ventana y 5 fuera de ella.
    await ctx.owner.telemetryReading.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        companyId: a.company.id,
        plantId: plant.id,
        ts: new Date(now.getTime() - (i < 20 ? i : 400 + i) * 3600_000),
        powerKw: 1,
        energyKwh: 0.25,
      })),
    });
    await ctx.owner.notification.createMany({
      data: [
        { status: 'sent' as const, sentAt: new Date(now.getTime() - 86_400_000) },
        { status: 'sent' as const, sentAt: new Date(now.getTime() - 2 * 86_400_000) },
        { status: 'failed' as const, sentAt: null },
      ].map((n) => ({
        companyId: a.company.id,
        recipient: 'x@y.mx',
        subject: 's',
        template: 't',
        ...n,
      })),
    });
    await ctx.owner.monthlyReport.create({
      data: {
        companyId: a.company.id,
        clientId: a.client.id,
        period: '2026-10',
        status: 'generated',
        storageKey: `reports/${a.company.id}/x.pdf`,
      },
    });
    await ctx.owner.aiUsageMonthly.createMany({
      data: [
        {
          companyId: a.company.id,
          period: '2026-10',
          feature: 'chat',
          inputTokens: 1000n,
          outputTokens: 200n,
          requests: 3,
        },
        {
          companyId: a.company.id,
          period: '2026-10',
          feature: 'alert_explanation',
          inputTokens: 500n,
          outputTokens: 50n,
          requests: 2,
        },
        {
          companyId: a.company.id,
          period: '2026-09',
          feature: 'chat',
          inputTokens: 9999n,
          outputTokens: 0n,
          requests: 1,
        },
      ],
    });

    const all = await measureCompanyUsage(ctx.db, ctx.serviceDb, now, options);
    const ua = all.find((c) => c.id === a.company.id);
    const ub = all.find((c) => c.id === b.company.id);
    expect(ua).toMatchObject({
      plants: 1,
      readingsPerDay: 2,
      emails: 6, // 2 en 10 días → 6 en 30
      reports: 1,
      storageBytes: 100 * 1024,
    });
    expect(ua?.ai).toEqual(
      expect.arrayContaining([
        {
          feature: 'chat',
          model: 'modelo-chat',
          inputTokens: 1000,
          outputTokens: 200,
          requests: 3,
        },
        {
          feature: 'alert_explanation',
          model: 'modelo-rapido',
          inputTokens: 500,
          outputTokens: 50,
          requests: 2,
        },
      ]),
    );
    expect(ua?.ai).toHaveLength(2);
    expect(ub).toMatchObject({ plants: 1, readingsPerDay: 0, emails: 0, reports: 0, ai: [] });
  });
});

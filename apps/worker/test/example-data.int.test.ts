import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExampleDataNotAllowedError, loadExampleData } from '../src/seed/demo.js';
import { createWorkerTestContext, type WorkerTestContext } from './helpers.js';

// Datos de ejemplo en una empresa existente (specs/PREGUNTAS.md #203): mismos escenarios que la
// demo, sin tocar a sus usuarios ni enviar correos. Historia corta para que la prueba sea rápida.

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  ctx.setNow(new Date('2026-10-21T19:00:00Z'));
});
afterAll(() => ctx.close());

describe('datos de ejemplo en una empresa existente', () => {
  it('llena la empresa vacía con clientes, plantas, historia y usuarios de ejemplo', async () => {
    const company = await ctx.owner.company.create({
      data: { name: 'Empresa 1', slug: `laempresa-${Date.now()}` },
    });
    const admin = await ctx.owner.user.create({
      data: {
        companyId: company.id,
        email: `admin-${Date.now()}@ejemplo.mx`,
        name: 'Admin',
        role: 'company_admin',
        status: 'active',
      },
    });
    const sentBefore = ctx.email.sent.length;

    const summary = await loadExampleData(ctx.deps, company.id, { days: 3 });
    expect(summary).toMatchObject({ plants: 25, metricDays: 3 });

    const count = (model: 'client' | 'solarPlant' | 'plantDailyMetric' | 'telemetryReading') =>
      (ctx.owner[model] as unknown as { count: (a: object) => Promise<number> }).count({
        where: { companyId: company.id },
      });
    expect(await count('client')).toBe(20);
    expect(await count('solarPlant')).toBe(25);
    expect(await count('plantDailyMetric')).toBeGreaterThan(0);
    expect(await count('telemetryReading')).toBeGreaterThan(0);

    const users = await ctx.owner.user.findMany({
      where: { companyId: company.id },
      orderBy: { email: 'asc' },
    });
    expect(users.map((u) => [u.role, u.passwordHash])).toEqual(
      expect.arrayContaining([
        ['operator', null],
        ['technician', null],
      ]),
    );
    // El administrador real no cambia y no salió ningún correo.
    expect(users.find((u) => u.id === admin.id)?.role).toBe('company_admin');
    expect(ctx.email.sent.length).toBe(sentBefore);

    await expect(loadExampleData(ctx.deps, company.id, { days: 3 })).rejects.toBeInstanceOf(
      ExampleDataNotAllowedError,
    );
  }, 180_000);
});

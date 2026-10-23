import { verifyPassword } from '@pv/adapters';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_SLUGS,
  DemoAlreadyExistsError,
  seedDemo,
  type SeedDemoResult,
} from '../src/seed/demo.js';
import { evaluateAlertQuality } from '../src/eval/alerts-eval.js';
import { createWorkerTestContext, type WorkerTestContext } from './helpers.js';

const DAYS = 21;

let ctx: WorkerTestContext;
let result: SeedDemoResult;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
  ctx.setNow(new Date('2026-10-20T20:00:00Z'));
  result = await seedDemo(ctx.deps, { days: DAYS });
}, 300_000);
afterAll(() => ctx.close());

const companyBySlug = (slug: string) => ctx.owner.company.findUniqueOrThrow({ where: { slug } });

describe('pnpm db:seed:demo', () => {
  it('crea las dos empresas con sus usuarios, clientes y plantas', async () => {
    const a = await companyBySlug(DEMO_SLUGS.a);
    const b = await companyBySlug(DEMO_SLUGS.b);
    const roles = async (companyId: string) =>
      (await ctx.owner.user.findMany({ where: { companyId } })).map((u) => u.role).sort();
    expect(await roles(a.id)).toEqual(['company_admin', 'operator', 'technician', 'technician']);
    expect(await roles(b.id)).toEqual(['company_admin']);
    expect(await ctx.owner.client.count({ where: { companyId: a.id } })).toBe(20);
    expect(await ctx.owner.solarPlant.count({ where: { companyId: a.id } })).toBe(25);
    expect(await ctx.owner.solarPlant.count({ where: { companyId: b.id } })).toBe(5);
    expect(await ctx.owner.user.count({ where: { role: 'superadmin' } })).toBeGreaterThan(0);

    // Las colonias de A son de Culiacán (6–8 distintas).
    const colonias = await ctx.owner.client.findMany({
      where: { companyId: a.id },
      distinct: ['colonia'],
    });
    expect(colonias.length).toBeGreaterThanOrEqual(6);
    expect(colonias.length).toBeLessThanOrEqual(8);
  });

  it('las contraseñas solo se devuelven para imprimirse; en la base solo queda el hash', async () => {
    expect(result.credentials).toHaveLength(1 + 4 + 1);
    for (const c of result.credentials) {
      const user = await ctx.owner.user.findUniqueOrThrow({ where: { email: c.email } });
      expect(user.passwordHash).not.toContain(c.password);
      expect(await verifyPassword(user.passwordHash, c.password)).toBe(true);
    }
  });

  it('ejecuta el pipeline real: telemetría, métricas de cada día y job_runs', async () => {
    for (const slug of Object.values(DEMO_SLUGS)) {
      const company = await companyBySlug(slug);
      const plants = await ctx.owner.solarPlant.findMany({ where: { companyId: company.id } });
      for (const p of plants) {
        expect(
          await ctx.owner.telemetryReading.count({ where: { plantId: p.id } }),
        ).toBeGreaterThan(0);
      }
      const metrics = await ctx.owner.plantDailyMetric.count({ where: { companyId: company.id } });
      expect(metrics).toBeGreaterThan(plants.length * (DAYS - 10));
      const runs = await ctx.owner.jobRun.groupBy({
        by: ['jobName'],
        where: { companyId: company.id, status: 'succeeded' },
      });
      expect(runs.map((r) => r.jobName).sort()).toEqual([
        'alerts.evaluate',
        'alerts.offline_company',
        'ingest.telemetry_plant',
        'metrics.recompute',
      ]);
    }
  });

  it('los escenarios se ven en plant_daily_metrics', async () => {
    const a = await companyBySlug(DEMO_SLUGS.a);
    const lastDay = new Date('2026-10-19T00:00:00Z');
    const rows = await ctx.owner.plantDailyMetric.findMany({
      where: { companyId: a.id, date: lastDay },
      include: { plant: { select: { simulationProfile: true } } },
    });
    const scenarioOf = (r: (typeof rows)[0]) =>
      (r.plant.simulationProfile as { scenarios: { type: string }[] }).scenarios[0]?.type;

    const failures = rows.filter((r) => scenarioOf(r) === 'string_failure');
    expect(failures).toHaveLength(2);
    // Ambas rinden un tercio menos; con 21 días de historia la antigua (hace 25 días) ya forma
    // su línea base, así que solo la reciente muestra la desviación.
    for (const r of failures) expect(Number(r.prTemp)).toBeLessThan(0.7);
    expect(Math.max(...failures.map((r) => Number(r.deviationPct)))).toBeGreaterThan(25);

    const offline = rows.filter((r) => scenarioOf(r) === 'offline');
    expect(offline.map((r) => r.status)).toEqual(['offline']);

    const normal = rows.filter((r) => scenarioOf(r) === undefined && r.isValidDay);
    for (const r of normal) expect(Math.abs(Number(r.deviationPct))).toBeLessThan(5);
  });

  it('las alertas salen de los jobs reales: falla de string reciente y planta offline', async () => {
    const a = await companyBySlug(DEMO_SLUGS.a);
    const alerts = await ctx.owner.alert.findMany({
      where: { companyId: a.id, status: { in: ['open', 'acknowledged'] } },
      include: { plant: { select: { simulationProfile: true } } },
    });
    const scenarioOf = (p: { simulationProfile: unknown }) =>
      (p.simulationProfile as { scenarios: { type: string; start: string }[] }).scenarios[0];
    const opened = alerts.map((x) => `${x.type}:${scenarioOf(x.plant)?.type ?? 'normal'}`);
    expect(opened).toContain('offline:offline');
    // La falla reciente (hace 3 días) se detecta; la antigua empezó antes de la historia.
    expect(opened).toContain('sudden_drop:string_failure');
    expect(opened.filter((o) => o.endsWith(':normal'))).toEqual([]);
  });

  it('la falla de string con alerta tiene un ticket abierto asignado a un técnico', async () => {
    const a = await companyBySlug(DEMO_SLUGS.a);
    const tickets = await ctx.owner.maintenanceTicket.findMany({
      where: { companyId: a.id },
      include: { alert: true, assignedTo: true },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      type: 'inspection',
      status: 'scheduled',
      alert: { type: 'sudden_drop', status: 'acknowledged' },
      assignedTo: { role: 'technician' },
    });
    expect(tickets[0]!.alert!.ticketId).toBe(tickets[0]!.id);
  });

  it('no vuelve a sembrar si la demo ya existe', async () => {
    await expect(seedDemo(ctx.deps, { days: 1 })).rejects.toBeInstanceOf(DemoAlreadyExistsError);
  });
});

describe('pnpm eval:alerts sobre la semilla', () => {
  const companyIds = async () =>
    (
      await ctx.owner.company.findMany({
        where: { slug: { in: Object.values(DEMO_SLUGS) } },
        select: { id: true },
      })
    ).map((c) => c.id);

  it('cumple las metas: detecta la falla de string y la planta offline, sin falsas', async () => {
    const report = await evaluateAlertQuality(ctx.db, await companyIds(), ctx.deps.now());
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    // La falla antigua empezó antes de los 21 días de historia: no cuenta.
    expect(report.recall.string_failure).toEqual({ injected: 1, detected: 1, pct: 100 });
    expect(report.recall.offline).toEqual({ injected: 1, detected: 1, pct: 100 });
    expect(report.falsePlantsPct).toBe(0);
    expect(report.normalPlants).toBe(15 + 2 + 5);
  });

  it('sin las alertas de caída brusca no cumple', async () => {
    await ctx.owner.maintenanceTicket.deleteMany({});
    await ctx.owner.alert.deleteMany({ where: { type: 'sudden_drop' } });
    const report = await evaluateAlertQuality(ctx.db, await companyIds(), ctx.deps.now());
    expect(report.passed).toBe(false);
    expect(report.recall.string_failure).toEqual({ injected: 1, detected: 0, pct: 0 });
    expect(report.failures[0]).toMatch(/Recall de string_failure: 0 %/);
  });
});

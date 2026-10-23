import { verifyPassword } from '@pv/adapters';
import { runTool } from '@pv/ai';
import { withTenant } from '@pv/db';
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
    // Todas las warning y critical llegan explicadas (con la IA simulada, por plantilla) y sin
    // correos: la semilla reproduce la historia.
    for (const x of alerts.filter((y) => y.severity !== 'info')) {
      expect(x.aiStatus).toBe('failed');
      expect(x.aiExplanation).toMatchObject({
        generated_by: 'template',
        resumen: expect.any(String),
      });
    }
    expect(await ctx.owner.notification.count({ where: { companyId: a.id } })).toBe(0);
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

describe('herramientas del asistente sobre la semilla (F8-T1)', () => {
  async function companyA() {
    const a = await companyBySlug(DEMO_SLUGS.a);
    return {
      a,
      ctxFor: () => ({ timezone: a.timezone, today: '2026-10-20', now: ctx.deps.now() }),
    };
  }
  /** Ejecuta una herramienta en la sesión de la empresa (pv_app con RLS) y mide el tiempo. */
  async function call(companyId: string, name: string, input: unknown) {
    const started = Date.now();
    const out = await withTenant(ctx.db, companyId, (tx) =>
      runTool(name, input, {
        tx,
        timezone: 'America/Mazatlan',
        today: '2026-10-20',
        now: ctx.deps.now(),
      }),
    );
    const ms = Date.now() - started;
    // specs/07 §2: cada herramienta responde en menos de 1 s con la semilla.
    expect(ms, `${name} tardó ${ms} ms`).toBeLessThan(1000);
    // Nunca teléfonos, correos ni domicilios.
    expect(JSON.stringify(out)).not.toMatch(/@|\b\d{3} ?\d{3} ?\d{4}\b|Domicilio de demostración/);
    return out;
  }
  const ok = (r: Awaited<ReturnType<typeof call>>) => {
    if (!r.ok) throw new Error(r.error);
    // Lo que recibiría el modelo: la salida serializada a JSON.
    return JSON.parse(JSON.stringify(r.output));
  };
  const scenarioPlants = async (companyId: string, type: string) =>
    (
      await ctx.owner.solarPlant.findMany({
        where: { companyId },
        select: { id: true, name: true, simulationProfile: true },
      })
    ).filter(
      (p) => (p.simulationProfile as { scenarios: { type: string }[] }).scenarios[0]?.type === type,
    );

  it('get_fleet_summary: plantas, PR de la flota con sumas reales y alertas', async () => {
    const { a } = await companyA();
    const out = ok(await call(a.id, 'get_fleet_summary', { period: { preset: 'last_7_days' } }));
    expect(out.plants.active).toBe(25);
    const sums = await ctx.owner.plantDailyMetric.aggregate({
      where: {
        companyId: a.id,
        isValidDay: true,
        date: { gte: new Date('2026-10-13T00:00:00Z'), lte: new Date('2026-10-19T00:00:00Z') },
      },
      _sum: { energyKwh: true, expectedTempKwh: true },
    });
    expect(out.pr_temp).toBeCloseTo(
      Number(sums._sum.energyKwh) / Number(sums._sum.expectedTempKwh),
      3,
    );
    expect(out.period).toBe('últimos 7 días (2026-10-13 a 2026-10-19)');
    expect(out.offline_plants).toBeGreaterThanOrEqual(1);
  });

  it('rank_plants: la falla de string reciente está entre las 5 peores del mes', async () => {
    const { a } = await companyA();
    const out = ok(
      await call(a.id, 'rank_plants', {
        metric: 'pr_temp',
        period: { preset: 'this_month' },
        order: 'asc',
        limit: 5,
      }),
    );
    const failures = (await scenarioPlants(a.id, 'string_failure')).map((p) => p.id);
    expect(out.plants.some((p: { plant_id: string }) => failures.includes(p.plant_id))).toBe(true);
    expect(out.plants[0].value).toBeLessThanOrEqual(out.plants[4].value);
    expect(out.plants[0].valid_days).toBeGreaterThan(0);
  });

  it('performance_by_zone y compare_periods con cifras de la base', async () => {
    const { a } = await companyA();
    const zones = ok(
      await call(a.id, 'performance_by_zone', {
        group_by: 'colonia',
        metric: 'energy_kwh',
        period: { preset: 'last_7_days' },
        min_plants: 1,
      }),
    );
    const total = zones.zones.reduce((s: number, z: { value: number }) => s + z.value, 0);
    const energy = await ctx.owner.plantDailyMetric.aggregate({
      where: {
        companyId: a.id,
        date: { gte: new Date('2026-10-13T00:00:00Z'), lte: new Date('2026-10-19T00:00:00Z') },
      },
      _sum: { energyKwh: true },
    });
    expect(total).toBeCloseTo(Number(energy._sum.energyKwh), 0);
    expect(zones.zones[0].value).toBeGreaterThanOrEqual(zones.zones.at(-1).value);

    const cmp = ok(
      await call(a.id, 'compare_periods', {
        metric: 'energy_kwh',
        period_a: { from: '2026-10-06', to: '2026-10-12' },
        period_b: { preset: 'last_7_days' },
      }),
    );
    expect(cmp.rows[0].value_b).toBeCloseTo(Number(energy._sum.energyKwh), 0);
    expect(cmp.rows[0].diff).toBeCloseTo(cmp.rows[0].value_b - cmp.rows[0].value_a, 0);
  });

  it('get_plants_at_risk incluye la falla de string con su pérdida estimada', async () => {
    const { a } = await companyA();
    const out = ok(await call(a.id, 'get_plants_at_risk', { horizon_days: 14 }));
    const failure = (await scenarioPlants(a.id, 'string_failure')).map((p) => p.id);
    const row = out.plants.find((p: { plant_id: string }) => failure.includes(p.plant_id));
    expect(row).toMatchObject({ worst_severity: expect.stringMatching(/warning|critical/) });
    expect(row.estimated_loss_kwh_per_day).toBeGreaterThan(0);
    expect(row.estimated_loss_mxn_per_day).toBeGreaterThan(0);
    expect(
      out.plants.some((p: { reasons: string[] }) => p.reasons.some((r) => r.startsWith('offline'))),
    ).toBe(true);
  });

  it('detalle, serie, alertas y tickets', async () => {
    const { a } = await companyA();
    const [failure] = await scenarioPlants(a.id, 'string_failure');
    const plants = ok(
      await call(a.id, 'search_plants', { query: failure!.name.slice(0, 8), limit: 50 }),
    );
    expect(plants.plants.some((p: { id: string }) => p.id === failure!.id)).toBe(true);

    const detail = ok(await call(a.id, 'get_plant_detail', { plant_id: failure!.id }));
    expect(detail.plant).not.toHaveProperty('phone');
    expect(detail.baseline).toMatchObject({ source: expect.any(String) });

    const series = ok(
      await call(a.id, 'get_plant_timeseries', {
        plant_id: failure!.id,
        metric: 'pr_temp',
        period: { from: '2026-09-21', to: '2026-10-19' },
      }),
    );
    expect(series.points.length).toBeLessThanOrEqual(29);
    expect(
      series.points.every(
        (p: { valid: boolean; value: number | null }) => p.valid || p.value === null,
      ),
    ).toBe(true);

    const critical = ok(await call(a.id, 'list_alerts', { severity: 'critical', limit: 50 }));
    expect(critical.total).toBe(
      await ctx.owner.alert.count({
        where: { companyId: a.id, severity: 'critical', status: { in: ['open', 'acknowledged'] } },
      }),
    );
    const tickets = ok(await call(a.id, 'list_tickets', {}));
    expect(tickets.total).toBe(1);
    expect(tickets.count_by_assignee[0]).toMatchObject({
      tickets: 1,
      assigned_to: expect.any(String),
    });
  });

  it('entradas inválidas regresan el error para que el modelo corrija', async () => {
    const { a } = await companyA();
    const bad = await call(a.id, 'rank_plants', {
      metric: 'pr',
      period: { preset: 'today' },
      order: 'asc',
    });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('metric') });
    expect(
      await call(a.id, 'get_plant_timeseries', {
        plant_id: (await scenarioPlants(a.id, 'string_failure'))[0]!.id,
        metric: 'energy_kwh',
        period: { from: '2024-01-01', to: '2026-01-01' },
      }),
    ).toEqual({ ok: false, error: 'El periodo máximo es de 400 días' });
    const points = Array.from({ length: 401 }, (_, i) => ({ x: i, y: i }));
    expect(
      await call(a.id, 'render_chart', {
        type: 'line',
        title: 'x',
        series: [{ name: 's', points }],
      }),
    ).toMatchObject({ ok: false });
    expect(await call(a.id, 'nada', {})).toEqual({
      ok: false,
      error: 'Herramienta desconocida: nada',
    });
  });

  it('aislamiento: un plant_id de B en la sesión de A responde "no encontrada" y las listas no traen B', async () => {
    const { a } = await companyA();
    const b = await companyBySlug(DEMO_SLUGS.b);
    const plantB = await ctx.owner.solarPlant.findFirstOrThrow({ where: { companyId: b.id } });
    for (const [name, input] of [
      ['get_plant_detail', { plant_id: plantB.id }],
      [
        'get_plant_timeseries',
        { plant_id: plantB.id, metric: 'energy_kwh', period: { preset: 'last_7_days' } },
      ],
    ] as const) {
      expect(await call(a.id, name, input)).toEqual({ ok: false, error: 'Planta no encontrada' });
    }
    const idsB = (await ctx.owner.solarPlant.findMany({ where: { companyId: b.id } })).map(
      (p) => p.id,
    );
    for (const [name, input] of [
      ['search_plants', { query: plantB.name, limit: 50 }],
      [
        'rank_plants',
        { metric: 'energy_kwh', period: { preset: 'last_30_days' }, order: 'desc', limit: 50 },
      ],
      ['get_plants_at_risk', { horizon_days: 60 }],
      ['list_alerts', { limit: 50 }],
    ] as const) {
      const text = JSON.stringify(await call(a.id, name, input));
      for (const id of idsB) expect(text).not.toContain(id);
    }
  });
});

// Al final: borra alertas y tickets de la semilla para comprobar que el reporte falla.
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

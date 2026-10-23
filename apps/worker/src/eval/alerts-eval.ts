import {
  addDays,
  daysBetween,
  evaluateOffline,
  localDate,
  parseCompanySettings,
  simulationProfileSchema,
  type SimulationScenario,
} from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';

// pnpm eval:alerts (specs/12 §4): calidad de detección sobre la semilla demo, cuyos escenarios
// se conocen porque están en simulation_profile.

const HOUR_MS = 3_600_000;
/** Minuto de cada hora en que corre alerts.offline (packages/adapters/src/jobs.ts). */
const OFFLINE_RUN_MINUTE = 20;

export const GOALS = {
  recallPct: 90,
  falsePlantsPct: 10,
  soilingDelayDays: 4,
  stringFailureDelayDays: 2,
  offlineDelayHours: 1,
} as const;

export type ScenarioResult = {
  plant: string;
  kind: 'soiling' | 'string_failure' | 'offline';
  /** Cuándo la falla se volvió detectable (fecha local o instante ISO para offline). */
  detectableFrom: string;
  detected: boolean;
  delay: number | null;
  withinGoal: boolean;
};

export type AlertEvalReport = {
  scenarios: ScenarioResult[];
  recall: Record<
    ScenarioResult['kind'],
    { injected: number; detected: number; pct: number | null }
  >;
  normalPlants: number;
  falseAlerts: { plant: string; type: string; date: string }[];
  falsePlantsPct: number;
  passed: boolean;
  failures: string[];
};

type CompanyData = Awaited<ReturnType<typeof loadCompany>>;

async function loadCompany(db: PrismaClient, companyId: string) {
  return withTenant(db, companyId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const plants = await tx.solarPlant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        simulationProfile: true,
        commissioningDate: true,
        createdAt: true,
      },
    });
    const [metrics, alerts, lastReadings] = await Promise.all([
      tx.plantDailyMetric.findMany({
        select: { plantId: true, date: true, isValidDay: true, deviationPct: true },
        orderBy: { date: 'asc' },
      }),
      tx.alert.findMany({
        select: { plantId: true, type: true, severity: true, detectedAt: true },
      }),
      tx.telemetryReading.groupBy({ by: ['plantId'], _max: { ts: true } }),
    ]);
    return { company, plants, metrics, alerts, lastReadings };
  });
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function scenarioOf(profile: unknown): SimulationScenario | null {
  const parsed = simulationProfileSchema.safeParse(profile);
  return parsed.success ? (parsed.data.scenarios[0] ?? null) : null;
}

/** Primera ejecución horaria de la regla offline en o después de `t`. */
function nextOfflineRun(t: Date): Date {
  const run = new Date(t);
  run.setUTCMinutes(OFFLINE_RUN_MINUTE, 0, 0);
  return run < t ? new Date(run.getTime() + HOUR_MS) : run;
}

function evaluateCompany(
  data: CompanyData,
  now: Date,
): {
  scenarios: ScenarioResult[];
  normal: string[];
  falseAlerts: AlertEvalReport['falseAlerts'];
} {
  const tz = data.company.timezone;
  const { thresholds } = parseCompanySettings(data.company.settings);
  const lastMetric = data.metrics.at(-1);
  const lastMetricDay = lastMetric ? isoDay(lastMetric.date) : null;
  const scenarios: ScenarioResult[] = [];
  const normal: string[] = [];
  const falseAlerts: AlertEvalReport['falseAlerts'] = [];

  for (const plant of data.plants) {
    const scenario = scenarioOf(plant.simulationProfile);
    const alerts = data.alerts.filter((a) => a.plantId === plant.id);
    const days = data.metrics.filter((m) => m.plantId === plant.id);

    if (!scenario || scenario.type === 'shading') {
      if (!scenario) normal.push(plant.name);
      if (scenario) continue;
      for (const a of alerts.filter((x) => x.severity !== 'info')) {
        falseAlerts.push({ plant: plant.name, type: a.type, date: localDate(a.detectedAt, tz) });
      }
      continue;
    }

    if (scenario.type === 'soiling') {
      // Inyectada = la pérdida cruzó el umbral en un día válido de la historia.
      const crossing = days.find(
        (d) =>
          d.isValidDay &&
          isoDay(d.date) >= scenario.start &&
          Number(d.deviationPct) > thresholds.soiling_deviation_pct,
      );
      if (!crossing) continue;
      const from = isoDay(crossing.date);
      const hit = alerts
        .filter((a) => a.type === 'soiling' && localDate(a.detectedAt, tz) >= scenario.start)
        .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime())[0];
      // Recién cruzado, aún no da tiempo de detectarla: no cuenta.
      if (!hit && lastMetricDay && daysBetween(from, lastMetricDay) < GOALS.soilingDelayDays) {
        continue;
      }
      const delay = hit ? daysBetween(from, localDate(hit.detectedAt, tz)) : null;
      scenarios.push({
        plant: plant.name,
        kind: 'soiling',
        detectableFrom: from,
        detected: Boolean(hit),
        delay,
        withinGoal: delay !== null && delay <= GOALS.soilingDelayDays,
      });
    } else if (scenario.type === 'string_failure') {
      if (!lastMetricDay || addDays(scenario.start, GOALS.stringFailureDelayDays) > lastMetricDay) {
        continue;
      }
      // Si empezó antes de la historia, el salto no se ve.
      const firstDay = days[0];
      if (!firstDay || isoDay(firstDay.date) >= scenario.start) continue;
      const hit = alerts
        .filter((a) => a.type === 'sudden_drop' && localDate(a.detectedAt, tz) >= scenario.start)
        .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime())[0];
      const delay = hit ? daysBetween(scenario.start, localDate(hit.detectedAt, tz)) : null;
      scenarios.push({
        plant: plant.name,
        kind: 'string_failure',
        detectableFrom: scenario.start,
        detected: Boolean(hit),
        delay,
        withinGoal: delay !== null && delay <= GOALS.stringFailureDelayDays,
      });
    } else if (scenario.type === 'offline' && plant.lat !== null && plant.lon !== null) {
      // La regla corre cada hora: se reproduce sobre la última lectura real para saber cuándo
      // se cumplió el umbral y cuándo la habría abierto el job.
      const lastReadingAt = data.lastReadings.find((r) => r.plantId === plant.id)?._max.ts ?? null;
      const start = lastReadingAt ?? plant.createdAt;
      let thresholdAt: Date | null = null;
      for (let t = start.getTime() + HOUR_MS / 12; t <= now.getTime(); t += HOUR_MS / 12) {
        const action = evaluateOffline({
          now: new Date(t),
          lat: Number(plant.lat),
          lon: Number(plant.lon),
          lastReadingAt,
          expectedSince: plant.createdAt,
          providerError: false,
          open: undefined,
          thresholds,
        });
        if (action?.kind === 'open') {
          thresholdAt = new Date(t);
          break;
        }
      }
      if (!thresholdAt) continue;
      const opened = alerts.some((a) => a.type === 'offline' && a.detectedAt >= start);
      const delay = (nextOfflineRun(thresholdAt).getTime() - thresholdAt.getTime()) / HOUR_MS;
      scenarios.push({
        plant: plant.name,
        kind: 'offline',
        detectableFrom: thresholdAt.toISOString(),
        detected: opened,
        delay: opened ? Math.round(delay * 100) / 100 : null,
        withinGoal: opened && delay <= GOALS.offlineDelayHours,
      });
    }
  }
  return { scenarios, normal, falseAlerts };
}

/** Evalúa la detección en las empresas dadas (las de la semilla demo). */
export async function evaluateAlertQuality(
  db: PrismaClient,
  companyIds: string[],
  now: Date,
): Promise<AlertEvalReport> {
  const scenarios: ScenarioResult[] = [];
  const normal: string[] = [];
  const falseAlerts: AlertEvalReport['falseAlerts'] = [];
  for (const id of companyIds) {
    const r = evaluateCompany(await loadCompany(db, id), now);
    scenarios.push(...r.scenarios);
    normal.push(...r.normal);
    falseAlerts.push(...r.falseAlerts);
  }

  const recall = {} as AlertEvalReport['recall'];
  const failures: string[] = [];
  for (const kind of ['soiling', 'string_failure', 'offline'] as const) {
    const of = scenarios.filter((s) => s.kind === kind);
    const detected = of.filter((s) => s.detected).length;
    const pct = of.length ? Math.round((1000 * detected) / of.length) / 10 : null;
    recall[kind] = { injected: of.length, detected, pct };
    if (pct !== null && pct < GOALS.recallPct) {
      failures.push(`Recall de ${kind}: ${pct} % (meta ≥ ${GOALS.recallPct} %)`);
    }
  }
  for (const s of scenarios.filter((x) => x.detected && !x.withinGoal)) {
    failures.push(`Retraso de ${s.kind} en ${s.plant}: ${s.delay} (fuera de la meta)`);
  }
  const falsePlants = new Set(falseAlerts.map((f) => f.plant)).size;
  const falsePlantsPct = normal.length ? Math.round((1000 * falsePlants) / normal.length) / 10 : 0;
  if (falsePlantsPct >= GOALS.falsePlantsPct) {
    failures.push(
      `Plantas normales con alertas falsas: ${falsePlantsPct} % (meta < ${GOALS.falsePlantsPct} %)`,
    );
  }
  return {
    scenarios,
    recall,
    normalPlants: normal.length,
    falseAlerts,
    falsePlantsPct,
    passed: failures.length === 0,
    failures,
  };
}

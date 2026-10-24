import {
  createAdapterRegistry,
  CredentialCipher,
  ingestTelemetryPlant,
  JobQueue,
  MemoryEmailProvider,
  MemoryStorageProvider,
  SyntheticWeatherProvider,
} from '@pv/adapters';
import { MockLLMProvider } from '@pv/ai';
import { loadEnvOrExit } from '@pv/config';
import { addDays, localDate, startOfLocalDay } from '@pv/core';
import { assertAppRoleIsSafe, createPrismaClient, withTenant } from '@pv/db';
import { pino } from 'pino';
import { ingestTelemetryJob, ingestTelemetryPlantJob } from '../jobs/telemetry.js';
import { ingestWeatherCompanyJob } from '../jobs/weather.js';
import { runJob, startJobs, type RuntimeDeps } from '../runtime.js';
import { CULIACAN_COLONIAS, type Colonia } from '../seed/demo-data.js';
import { dbSimulatorSource } from '../simulator-source.js';

// Prueba de carga de F10-T4 (specs/11): una empresa con 500 plantas simuladas. Mide un ciclo
// completo de ingest.telemetry (orquestador + un job por planta en pg-boss, con la concurrencia
// configurada) y deja 90 días de métricas para medir el tablero con `pnpm --filter @pv/api
// load:dashboard`. Solo corre sobre una base cuyo nombre contiene "load".

const PLANTS = Number(process.env.LOAD_PLANTS ?? 500);
const SLUG = 'carga-500';
const DAYS = 90;
const TZ = 'America/Mazatlan';
const LIMIT_MS = 5 * 60_000;

const env = loadEnvOrExit();
if (env.NODE_ENV === 'production' || !/load/.test(new URL(env.DATABASE_URL).pathname)) {
  console.error(
    'Solo sobre una base de pruebas cuyo nombre contiene "load" y fuera de producción.',
  );
  process.exit(2);
}
const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
await assertAppRoleIsSafe(db);

// Mediodía local de hoy: todas las plantas están dentro de la ventana de sol.
const today = localDate(new Date(), TZ);
const noon = new Date(startOfLocalDay(today, TZ).getTime() + 12 * 3_600_000);
const rand = (() => {
  let s = 42;
  return () => (s = (s * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
})();

async function ensureCompany() {
  const existing = await serviceDb.company.findUnique({ where: { slug: SLUG } });
  if (existing) return existing;
  const company = await serviceDb.company.create({
    data: { name: 'Carga 500 plantas', slug: SLUG, timezone: TZ },
  });
  console.log(`Creando ${PLANTS} plantas y ${DAYS} días de métricas…`);
  await withTenant(
    db,
    company.id,
    async (tx) => {
      const clients = await tx.client.createManyAndReturn({
        data: Array.from({ length: Math.ceil(PLANTS / 5) }, (_, i) => {
          const c = CULIACAN_COLONIAS[i % CULIACAN_COLONIAS.length] as Colonia;
          return {
            companyId: company.id,
            name: `Cliente de carga ${i + 1}`,
            address: `Domicilio de prueba ${i + 1}`,
            colonia: c.name,
            postalCode: c.postalCode,
            lat: c.lat,
            lon: c.lon,
          };
        }),
        select: { id: true, colonia: true, postalCode: true, lat: true, lon: true },
      });
      const plants = await tx.solarPlant.createManyAndReturn({
        data: Array.from({ length: PLANTS }, (_, i) => {
          const c = clients[Math.floor(i / 5)] as (typeof clients)[number];
          return {
            companyId: company.id,
            clientId: c.id,
            name: `Planta de carga ${i + 1}`,
            capacityKwp: 3 + Math.round(rand() * 270) / 10,
            tiltDeg: 15 + Math.round(rand() * 10),
            azimuthDeg: 170 + Math.round(rand() * 20),
            inverterBrand: 'simulator' as const,
            postalCode: c.postalCode,
            colonia: c.colonia,
            lat: Number(c.lat) + (rand() - 0.5) * 0.02,
            lon: Number(c.lon) + (rand() - 0.5) * 0.02,
            commissioningDate: new Date(`${addDays(today, -400)}T00:00:00Z`),
            lastReadingAt: new Date(noon.getTime() - 15 * 60_000),
            lastPowerKw: 2,
            simulationProfile: {
              seed: i + 1,
              system_efficiency: 0.86,
              ac_limit_kw: 30,
              noise_pct: 2,
              scenarios: [],
            },
          };
        }),
        select: {
          id: true,
          clientId: true,
          postalCode: true,
          colonia: true,
          capacityKwp: true,
        },
      });
      for (let d = DAYS; d >= 1; d--) {
        const date = new Date(`${addDays(today, -d)}T00:00:00Z`);
        await tx.plantDailyMetric.createMany({
          data: plants.map((p) => {
            const kwp = p.capacityKwp.toNumber();
            const expected = kwp * 5.6;
            const pr = 0.78 + rand() * 0.12;
            return {
              companyId: company.id,
              plantId: p.id,
              date,
              clientId: p.clientId,
              postalCode: p.postalCode,
              colonia: p.colonia,
              energyKwh: expected * pr,
              irradiationPoaKwhM2: 6.4,
              expectedStcKwh: expected * 1.1,
              expectedTempKwh: expected,
              specificYieldKwhKwp: 5.6 * pr,
              prTemp: pr,
              prBaseline: 0.85,
              baselineSource: 'own' as const,
              deviationPct: (0.85 - pr) * 100,
              cloudCoverAvgPct: rand() * 40,
              dataCompletenessPct: 100,
              isValidDay: true,
              daysToCleaning: rand() < 0.1 ? Math.round(rand() * 14) : null,
              status: pr < 0.8 ? ('warning' as const) : ('ok' as const),
            };
          }),
        });
      }
      await tx.alert.createMany({
        data: plants.slice(0, 25).map((p, i) => ({
          companyId: company.id,
          plantId: p.id,
          type: i % 3 === 0 ? ('sudden_drop' as const) : ('soiling' as const),
          severity: i % 3 === 0 ? ('critical' as const) : ('warning' as const),
          detectedAt: new Date(noon.getTime() - i * 3_600_000),
          evidence: { rule: 'carga' },
        })),
      });
    },
    { timeout: 10 * 60_000 },
  );
  return company;
}

const company = await ensureCompany();
const queue = await JobQueue.start(env.SERVICE_DATABASE_URL, { pollingIntervalSeconds: 0.5 });
const deps: RuntimeDeps = {
  db,
  serviceDb,
  queue,
  weather: new SyntheticWeatherProvider(),
  cipher: CredentialCipher.fromEnv(env),
  adapters: (companyId) => createAdapterRegistry({ simulator: dbSimulatorSource(db, companyId) }),
  email: new MemoryEmailProvider(),
  storage: new MemoryStorageProvider(),
  ai: { provider: new MockLLMProvider(), chatModel: 'mock', fastModel: 'mock' },
  appUrl: env.APP_URL,
  logger,
  now: () => noon,
};

// Clima de las últimas horas (lo usa el simulador); no cuenta en la medición.
await runJob(ingestWeatherCompanyJob, { company_id: company.id, at: noon.toISOString() }, 0, deps);
await withTenant(db, company.id, (tx) =>
  tx.solarPlant.updateMany({ data: { lastReadingAt: new Date(noon.getTime() - 15 * 60_000) } }),
);

await queue.ensureQueue(ingestTelemetryPlant);
const started = new Date();
const t0 = performance.now();
await runJob(ingestTelemetryJob, {}, 0, deps);
await startJobs([ingestTelemetryPlantJob], deps);
let done = 0;
let failed = 0;
while (performance.now() - t0 < LIMIT_MS * 2) {
  const runs = await serviceDb.jobRun.groupBy({
    by: ['status'],
    where: {
      jobName: 'ingest.telemetry_plant',
      companyId: company.id,
      // job_runs usa el reloj simulado en started_at; created_at es la hora real.
      createdAt: { gte: started },
    },
    _count: { _all: true },
  });
  done = runs.find((r) => r.status === 'succeeded')?._count._all ?? 0;
  failed = runs.find((r) => r.status === 'failed')?._count._all ?? 0;
  if (done + failed >= PLANTS) break;
  await new Promise((r) => setTimeout(r, 250));
}
const elapsed = performance.now() - t0;
const readings = await withTenant(db, company.id, (tx) =>
  tx.telemetryReading.count({ where: { ts: { gte: new Date(noon.getTime() - 3_600_000) } } }),
);
await queue.stop();
await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);

const ok = done === PLANTS && elapsed < LIMIT_MS;
console.log(
  JSON.stringify(
    {
      plants: PLANTS,
      succeeded: done,
      failed,
      seconds: Math.round(elapsed / 100) / 10,
      per_plant_ms: Math.round(elapsed / Math.max(done, 1)),
      concurrency: ingestTelemetryPlant.concurrency,
      readings_last_hour: readings,
      limit_seconds: LIMIT_MS / 1000,
      result: ok ? 'CUMPLE' : 'NO CUMPLE',
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

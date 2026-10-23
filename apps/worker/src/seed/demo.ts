import { randomBytes } from 'node:crypto';
import { hashPassword, type WeatherProvider } from '@pv/adapters';
import {
  addDays,
  localDate,
  parseCompanySettings,
  rainResetTimes,
  seededRandom,
  simulationProfileSchema,
  startOfLocalDay,
  type SimulationScenario,
} from '@pv/core';
import { withTenant, type TenantDb } from '@pv/db';
import { explainAlertFor } from '../jobs/ai.js';
import { alertsEvaluateJob, alertsOfflineCompanyJob } from '../jobs/alerts.js';
import { metricsRecomputeJob } from '../jobs/metrics.js';
import { ingestTelemetryPlantJob } from '../jobs/telemetry.js';
import { ingestWeatherRange } from '../jobs/weather.js';
import { runJob, type JobContext, type RuntimeDeps } from '../runtime.js';
import {
  BUSINESS_NAMES,
  CLIENT_FIRST_NAMES,
  CLIENT_LAST_NAMES,
  COMPANY_A_PLANTS,
  COMPANY_B_PLANTS,
  CULIACAN_COLONIAS,
  MAZATLAN_COLONIAS,
  type Colonia,
  type DemoPlant,
} from './demo-data.js';

// Semilla de demo (specs/04 §4). Crea empresas, usuarios, clientes y plantas simuladas y luego
// EJECUTA el pipeline real (clima → telemetría → métricas) sobre la historia: no inserta
// métricas a mano. Las contraseñas se generan al azar y solo se devuelven para imprimirlas.

const HOUR_MS = 3_600_000;
const TELEMETRY_STEP_DAYS = 6; // el ingestor lee como mucho 7 días hacia atrás
const TZ = 'America/Mazatlan';

export const DEMO_SLUGS = { a: 'solar-demo-culiacan', b: 'demo-mazatlan' } as const;
export const DEMO_EMAIL_DOMAIN = 'demo.pv-iot.example';

export class DemoAlreadyExistsError extends Error {
  constructor() {
    super('La demo ya existe en esta base de datos; recréala desde cero para volver a sembrar.');
    this.name = 'DemoAlreadyExistsError';
  }
}

export type DemoCredential = {
  email: string;
  role: string;
  company: string | null;
  password: string;
};

export type SeedDemoResult = {
  credentials: DemoCredential[];
  companies: { slug: string; plants: number; metricDays: number }[];
};

type SeededPlant = { id: string; demo: DemoPlant; lat: number; lon: number };

const password = () => randomBytes(12).toString('base64url');

/** Punto aproximado dentro de la colonia (≈ ±400 m), determinista. */
function jitter(c: Colonia, r: () => number) {
  const d = 0.004;
  return {
    lat: Number((c.lat + (r() * 2 - 1) * d).toFixed(6)),
    lon: Number((c.lon + (r() * 2 - 1) * d).toFixed(6)),
  };
}

type Location = { colonia: Colonia; lat: number; lon: number };

const soilingLoss = (p: DemoPlant) => (p.scenario.kind === 'soiling' ? p.scenario.lossTodayPct : 0);

/**
 * Ubicación de cada cliente. A los clientes de plantas con suciedad se les asignan los puntos con
 * la última lluvia más antigua, para que la tendencia sea visible (la lluvia la reinicia).
 */
async function clientLocations(
  weather: WeatherProvider,
  plants: DemoPlant[],
  colonias: Colonia[],
  clientCount: number,
  rand: () => number,
  window: { from: Date; to: Date },
  rainResetMm: number,
): Promise<Location[]> {
  const locations = Array.from({ length: clientCount }, (_, i) => {
    const colonia = colonias[i % colonias.length] as Colonia;
    return { colonia, ...jitter(colonia, rand) };
  });
  const soiling = plants
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.scenario.kind === 'soiling' && i < clientCount)
    // La más sucia recibe el punto más seco: necesita más días para acumular su pérdida.
    .sort((a, b) => soilingLoss(b.p) - soilingLoss(a.p));
  if (soiling.length === 0) return locations;

  const candidates = colonias.flatMap((colonia) =>
    [0, 1, 2].map(() => ({ colonia, ...jitter(colonia, rand) })),
  );
  const scored = [];
  for (const c of candidates) {
    const hours = await weather.fetchHourly({
      lat: c.lat,
      lon: c.lon,
      tiltDeg: 20,
      azimuthDeg: 180,
      ...window,
    });
    const resets = rainResetTimes(
      hours.map((h) => ({ ts: h.ts, precipitationMm: h.precipitationMm, poaWm2: 0, tempAmbC: 0 })),
      TZ,
      rainResetMm,
    );
    scored.push({ c, lastRain: resets.at(-1)?.getTime() ?? 0 });
  }
  scored.sort((a, b) => a.lastRain - b.lastRain);
  for (const [k, { i }] of soiling.entries()) {
    locations[i] = (scored[k % scored.length] as (typeof scored)[0]).c;
  }
  return locations;
}

async function createUsers(
  deps: RuntimeDeps,
  companyId: string | null,
  companyName: string | null,
  users: {
    email: string;
    name: string;
    role: 'superadmin' | 'company_admin' | 'operator' | 'technician';
  }[],
): Promise<DemoCredential[]> {
  const out: DemoCredential[] = [];
  for (const u of users) {
    const pw = password();
    await deps.serviceDb.user.create({
      data: {
        companyId,
        email: u.email,
        name: u.name,
        role: u.role,
        status: 'active',
        passwordHash: await hashPassword(pw),
      },
    });
    out.push({ email: u.email, role: u.role, company: companyName, password: pw });
  }
  return out;
}

/** Clientes y plantas de una empresa; reparte las plantas entre `clientCount` clientes. */
async function createPlants(
  tx: TenantDb,
  companyId: string,
  plants: DemoPlant[],
  locations: Location[],
  city: string,
  today: string,
  rand: () => number,
): Promise<SeededPlant[]> {
  const clientCount = locations.length;
  const clients: { id: string; colonia: Colonia; lat: number; lon: number }[] = [];
  let business = 0;
  for (const [i, { colonia, lat, lon }] of locations.entries()) {
    const commercial = plants[i]?.kind === 'commercial';
    const first = CLIENT_FIRST_NAMES[i % CLIENT_FIRST_NAMES.length] as string;
    const last = CLIENT_LAST_NAMES[(i * 3) % CLIENT_LAST_NAMES.length] as string;
    const name = commercial
      ? (BUSINESS_NAMES[business++ % BUSINESS_NAMES.length] as string)
      : `${first} ${last}`;
    const client = await tx.client.create({
      data: {
        companyId,
        name,
        contactName: `${first} ${last}`,
        phone: `667${String(1_000_000 + i * 7919).slice(0, 7)}`,
        email: `cliente${i + 1}@${DEMO_EMAIL_DOMAIN}`,
        address: `Domicilio de demostración ${i + 1}`,
        colonia: colonia.name,
        postalCode: colonia.postalCode,
        city,
        lat,
        lon,
        cfeTariff: commercial ? 'PDBT' : '1F',
        tariffMxnPerKwh: commercial ? 3.4 : 2.1,
      },
    });
    clients.push({ id: client.id, colonia, lat, lon });
  }

  const seeded: SeededPlant[] = [];
  for (const [i, demo] of plants.entries()) {
    // Las primeras plantas van una por cliente; las que sobran, a clientes ya creados.
    const client = clients[i < clientCount ? i : (i * 7) % clientCount] as (typeof clients)[0];
    const s = demo.scenario;
    // Con suciedad, la planta queda justo en el punto seco elegido para su cliente.
    const { lat, lon } =
      s.kind === 'soiling' && i < clientCount ? client : jitter(client.colonia, rand);
    const commissioning =
      s.kind === 'new'
        ? addDays(today, -s.daysAgo)
        : addDays(today, -400 - Math.floor(rand() * 900));
    const plant = await tx.solarPlant.create({
      data: {
        companyId,
        clientId: client.id,
        name: `${demo.kind === 'commercial' ? 'Comercial' : 'Residencial'} ${client.colonia.name} ${i + 1}`,
        capacityKwp: demo.capacityKwp,
        tiltDeg: demo.kind === 'commercial' ? 10 : 15 + Math.round(rand() * 10),
        azimuthDeg: 180 + Math.round((rand() * 2 - 1) * 20),
        panelCount: Math.round((demo.capacityKwp * 1000) / 550),
        panelModel: 'Módulo 550 W (demo)',
        inverterBrand: 'simulator',
        inverterModel: 'Simulador',
        commissioningDate: new Date(`${commissioning}T00:00:00Z`),
        lat,
        lon,
        postalCode: client.colonia.postalCode,
        colonia: client.colonia.name,
      },
    });
    seeded.push({ id: plant.id, demo, lat, lon });
  }
  return seeded;
}

/**
 * Escenarios del simulador. La suciedad empieza después de la última lluvia que lava los paneles
 * (si no, la lluvia la reiniciaría) con la tasa que deja la pérdida pedida hoy.
 */
async function scenariosFor(
  tx: TenantDb,
  plant: SeededPlant,
  now: Date,
  today: string,
  historyStart: string,
  rainResetMm: number,
): Promise<SimulationScenario[]> {
  const s = plant.demo.scenario;
  switch (s.kind) {
    case 'normal':
    case 'new':
      return [];
    case 'string_failure':
      return [
        {
          type: 'string_failure',
          start: addDays(today, -s.daysAgo),
          loss_pct: s.lossPct,
          end: null,
        },
      ];
    case 'offline':
      return [
        {
          type: 'offline',
          // Desde las 09:00 locales de hace `daysAgo` días: los días completos quedan sin datos.
          start: new Date(
            startOfLocalDay(addDays(today, -s.daysAgo), TZ).getTime() + 9 * HOUR_MS,
          ).toISOString(),
          end: null,
        },
      ];
    case 'shading':
      return [
        {
          type: 'shading',
          start: addDays(today, -s.daysAgo),
          loss_pct: s.lossPct,
          local_hours: s.localHours,
        },
      ];
    case 'soiling': {
      const weather = await tx.plantWeatherHourly.findMany({
        where: { plantId: plant.id, precipitationMm: { gt: 0 } },
        select: { ts: true, precipitationMm: true },
      });
      const resets = rainResetTimes(
        weather.map((w) => ({
          ts: w.ts,
          precipitationMm: Number(w.precipitationMm),
          poaWm2: 0,
          tempAmbC: 0,
        })),
        TZ,
        rainResetMm,
      );
      const lastRain = resets.length
        ? localDate(resets[resets.length - 1] as Date, TZ)
        : historyStart;
      const start = lastRain > historyStart ? addDays(lastRain, 1) : historyStart;
      const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(start)) / 86_400_000));
      const rate = Math.min(5, Number((s.lossTodayPct / days).toFixed(3)));
      return [{ type: 'soiling', start, rate_pct_per_day: Math.max(0.001, rate) }];
    }
  }
}

async function seedCompany(
  deps: RuntimeDeps,
  opts: {
    name: string;
    slug: string;
    plants: DemoPlant[];
    colonias: Colonia[];
    clients: number;
    city: string;
    users: Parameters<typeof createUsers>[3];
    days: number;
    seed: number;
  },
) {
  const now = deps.now();
  const today = localDate(now, TZ);
  const historyStart = addDays(today, -opts.days);
  const rand = seededRandom(`demo:${opts.slug}:${opts.seed}`);
  const company = await deps.serviceDb.company.create({
    data: { name: opts.name, slug: opts.slug, timezone: TZ },
  });
  const credentials = await createUsers(deps, company.id, company.name, opts.users);
  const rainResetMm = parseCompanySettings(company.settings).thresholds.rain_reset_mm;
  const locations = await clientLocations(
    deps.weather,
    opts.plants,
    opts.colonias,
    opts.clients,
    rand,
    {
      from: startOfLocalDay(historyStart, TZ),
      to: new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS),
    },
    rainResetMm,
  );
  const plants = await withTenant(deps.db, company.id, (tx) =>
    createPlants(tx, company.id, opts.plants, locations, opts.city, today, rand),
  );

  // 1. Clima de toda la historia (el simulador y las métricas lo leen de la base).
  const ctx: JobContext = { ...deps, companyId: company.id, attempt: 0, log: deps.logger };
  await ingestWeatherRange(ctx, company.id, {
    from: startOfLocalDay(historyStart, TZ),
    to: new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS),
  });

  // 2. Perfil del simulador con los escenarios.
  await withTenant(deps.db, company.id, async (tx) => {
    for (const [i, plant] of plants.entries()) {
      const profile = simulationProfileSchema.parse({
        seed: opts.seed * 1000 + i,
        system_efficiency: Number((0.86 + rand() * 0.04).toFixed(3)),
        ac_limit_kw: Number((plant.demo.capacityKwp * 0.95).toFixed(2)),
        noise_pct: 2,
        scenarios: await scenariosFor(tx, plant, now, today, historyStart, rainResetMm),
      });
      await tx.solarPlant.update({ where: { id: plant.id }, data: { simulationProfile: profile } });
    }
  });

  // 3. Telemetría: el ingestor real, avanzando el reloj por tramos hasta ahora.
  const runAt = (at: Date): RuntimeDeps => ({ ...deps, now: () => at });
  const startMs = startOfLocalDay(historyStart, TZ).getTime();
  for (
    let t = startMs + TELEMETRY_STEP_DAYS * 24 * HOUR_MS;
    ;
    t += TELEMETRY_STEP_DAYS * 24 * HOUR_MS
  ) {
    const at = new Date(Math.min(t, now.getTime()));
    for (const plant of plants) {
      const outcome = await runJob(
        ingestTelemetryPlantJob,
        { company_id: company.id, plant_id: plant.id },
        0,
        runAt(at),
      );
      if (outcome !== 'succeeded') throw new Error(`Falló la telemetría de la planta ${plant.id}`);
    }
    if (at.getTime() === now.getTime()) break;
  }

  // 4. Cada día completo, en orden, como el worker cada noche: métricas y luego alertas (las
  // alertas sudden_drop abiertas excluyen esos días de la línea base de los días siguientes).
  const yesterday = addDays(today, -1);
  for (let date = historyStart; date <= yesterday; date = addDays(date, 1)) {
    const payload = { company_id: company.id, from: date, to: date };
    if ((await runJob(metricsRecomputeJob, payload, 0, deps)) !== 'succeeded') {
      throw new Error(`Falló el cálculo de métricas de ${opts.slug} del ${date}`);
    }
    const alerts = { company_id: company.id, date };
    if ((await runJob(alertsEvaluateJob, alerts, 0, deps)) !== 'succeeded') {
      throw new Error(`Falló la evaluación de alertas de ${opts.slug} del ${date}`);
    }
  }
  // 5. Regla offline con la hora actual.
  if (
    (await runJob(alertsOfflineCompanyJob, { company_id: company.id }, 0, deps)) !== 'succeeded'
  ) {
    throw new Error(`Falló la regla offline de ${opts.slug}`);
  }
  // 5b. Explicación de las alertas abiertas (specs/07 §3), sin esperar al worker. Con
  // LLM_PROVIDER=mock se usa la plantilla.
  const toExplain = await withTenant(deps.db, company.id, (tx) =>
    tx.alert.findMany({
      where: { status: { in: ['open', 'acknowledged'] }, severity: { not: 'info' } },
      select: { id: true },
    }),
  );
  for (const a of toExplain) await explainAlertFor(ctx, company.id, a.id, false);
  // 6. Ticket abierto para la falla de string más antigua con alerta (specs/04 §4), asignado
  // al primer técnico, como lo crearía el operador desde la alerta.
  await withTenant(deps.db, company.id, async (tx) => {
    const failures = plants.filter((p) => p.demo.scenario.kind === 'string_failure');
    const alert = await tx.alert.findFirst({
      where: {
        plantId: { in: failures.map((p) => p.id) },
        type: 'sudden_drop',
        status: { in: ['open', 'acknowledged'] },
      },
      orderBy: { detectedAt: 'asc' },
      include: { plant: { select: { name: true } } },
    });
    const technician = await tx.user.findFirst({
      where: { role: 'technician', status: 'active' },
      orderBy: { email: 'asc' },
    });
    const operator = await tx.user.findFirst({ where: { role: 'operator' } });
    if (!alert || !technician) return;
    const ticket = await tx.maintenanceTicket.create({
      data: {
        companyId: company.id,
        plantId: alert.plantId,
        alertId: alert.id,
        type: 'inspection',
        priority: alert.severity === 'critical' ? 'high' : 'normal',
        status: 'scheduled',
        title: `Revisión por caída de producción — ${alert.plant.name}`,
        description: 'Caída brusca de producción; revisar inversor y strings.',
        assignedToId: technician.id,
        scheduledFor: new Date(`${addDays(today, 1)}T00:00:00Z`),
        createdById: operator?.id ?? null,
      },
    });
    await tx.alert.update({
      where: { id: alert.id },
      data: { ticketId: ticket.id, status: 'acknowledged' },
    });
  });

  return {
    credentials,
    summary: { slug: opts.slug, plants: plants.length, metricDays: opts.days },
  };
}

/** Siembra la demo. Falla si ya existe (no borra nada). `days` permite historias cortas en pruebas. */
export async function seedDemo(
  runtime: RuntimeDeps,
  opts: { days?: number } = {},
): Promise<SeedDemoResult> {
  // La historia sembrada nunca envía correos (specs/PREGUNTAS.md #129).
  const deps: RuntimeDeps = { ...runtime, suppressNotifications: true, inlineExplanations: true };
  const days = opts.days ?? 90;
  const existing = await deps.serviceDb.company.count({
    where: { slug: { in: [DEMO_SLUGS.a, DEMO_SLUGS.b] } },
  });
  if (existing > 0) throw new DemoAlreadyExistsError();

  const credentials: DemoCredential[] = [];
  const superadminEmail = `superadmin@${DEMO_EMAIL_DOMAIN}`;
  if (!(await deps.serviceDb.user.findUnique({ where: { email: superadminEmail } }))) {
    credentials.push(
      ...(await createUsers(deps, null, null, [
        { email: superadminEmail, name: 'Superadmin Demo', role: 'superadmin' },
      ])),
    );
  }

  const mail = (local: string, company: string) => `${local}@${company}.${DEMO_EMAIL_DOMAIN}`;
  const a = await seedCompany(deps, {
    name: 'Solar Demo Culiacán',
    slug: DEMO_SLUGS.a,
    plants: COMPANY_A_PLANTS,
    colonias: CULIACAN_COLONIAS,
    clients: 20,
    city: 'Culiacán',
    users: [
      { email: mail('admin', 'culiacan'), name: 'Adriana Admin', role: 'company_admin' },
      { email: mail('operador', 'culiacan'), name: 'Omar Operador', role: 'operator' },
      { email: mail('tecnico1', 'culiacan'), name: 'Tomás Técnico', role: 'technician' },
      { email: mail('tecnico2', 'culiacan'), name: 'Tania Técnica', role: 'technician' },
    ],
    days,
    seed: 1,
  });
  const b = await seedCompany(deps, {
    name: 'Demo Mazatlán',
    slug: DEMO_SLUGS.b,
    plants: COMPANY_B_PLANTS,
    colonias: MAZATLAN_COLONIAS,
    clients: 4,
    city: 'Mazatlán',
    users: [{ email: mail('admin', 'mazatlan'), name: 'Marco Admin', role: 'company_admin' }],
    days,
    seed: 2,
  });
  return {
    credentials: [...credentials, ...a.credentials, ...b.credentials],
    companies: [a.summary, b.summary],
  };
}

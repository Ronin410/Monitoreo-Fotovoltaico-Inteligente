import type { AddressInfo } from 'node:net';
import { MemoryEmailProvider, MemoryJobEnqueuer, MemoryStorageProvider } from '@pv/adapters';
import { createAiConfig } from '@pv/ai';
import { loadEnvOrExit } from '@pv/config';
import { assertAppRoleIsSafe, createPrismaClient } from '@pv/db';
import { pino } from 'pino';
import { createApp } from '../app.js';
import { signAccessToken } from '../auth/tokens.js';

// Prueba de carga del tablero (F10-T4): con la empresa de `pnpm --filter @pv/worker load:test`
// (500 plantas, 90 días de métricas) mide las peticiones que hace el tablero al abrirse, en
// paralelo como el navegador. Meta: menos de 2 s. Solo sobre una base cuyo nombre contiene "load".

const SLUG = 'carga-500';
const RUNS = Number(process.env.LOAD_RUNS ?? 10);
const LIMIT_MS = 2000;
/** Lo que pide la página de inicio (apps/web/src/components/dashboard). */
const DASHBOARD = [
  '/me',
  '/dashboard/summary',
  '/dashboard/map',
  '/dashboard/top-bottom?days=30',
  '/dashboard/upcoming-cleanings?days=14',
  '/alerts?open=true&page_size=50',
];
/** Otras pantallas con listas de toda la flota. */
const OTHERS = ['/plants?page_size=25', '/plants?page_size=25&sort=pr_7d', '/alerts?page_size=25'];

const env = loadEnvOrExit();
if (env.NODE_ENV === 'production' || !/load/.test(new URL(env.DATABASE_URL).pathname)) {
  console.error(
    'Solo sobre una base de pruebas cuyo nombre contiene "load" y fuera de producción.',
  );
  process.exit(2);
}
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
await assertAppRoleIsSafe(db);

const company = await serviceDb.company.findUnique({ where: { slug: SLUG } });
if (!company) {
  console.error('Falta la empresa de carga: corre antes pnpm --filter @pv/worker load:test');
  process.exit(1);
}
const admin =
  (await serviceDb.user.findFirst({ where: { companyId: company.id, role: 'company_admin' } })) ??
  (await serviceDb.user.create({
    data: {
      companyId: company.id,
      email: 'admin@carga-500.example',
      name: 'Admin de carga',
      role: 'company_admin',
      status: 'active',
    },
  }));

const app = createApp({
  env,
  db,
  serviceDb,
  email: new MemoryEmailProvider(),
  storage: new MemoryStorageProvider(),
  jobs: new MemoryJobEnqueuer(),
  logger: pino({ level: 'silent' }),
  ai: createAiConfig({ ...env, LLM_PROVIDER: 'mock' }),
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const token = await signAccessToken(
  env.JWT_SECRET,
  { userId: admin.id, companyId: company.id, role: 'company_admin' },
  new Date(),
);

async function timed(path: string): Promise<number> {
  const t = performance.now();
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${path} respondió ${res.status}`);
  return performance.now() - t;
}

/** Tiempo de abrir el tablero: todas las peticiones en paralelo, hasta la última. */
async function page(paths: string[]) {
  const t = performance.now();
  const each = await Promise.all(paths.map(timed));
  return { total: performance.now() - t, each };
}

const p = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};
const ms = (v: number) => Math.round(v);

const cold = await page(DASHBOARD);
const warm: Awaited<ReturnType<typeof page>>[] = [];
for (let i = 0; i < RUNS; i++) warm.push(await page(DASHBOARD));
const perPath = Object.fromEntries(
  DASHBOARD.map((path, i) => [
    path,
    ms(
      p(
        warm.map((w) => w.each[i] ?? 0),
        0.95,
      ),
    ),
  ]),
);
const others = Object.fromEntries(
  await Promise.all(OTHERS.map(async (path) => [path, ms(await timed(path))] as const)),
);
const plants = await serviceDb.solarPlant.count({ where: { companyId: company.id } });

server.close();
await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);

const p95 = p(
  warm.map((w) => w.total),
  0.95,
);
const ok = cold.total < LIMIT_MS && p95 < LIMIT_MS;
console.log(
  JSON.stringify(
    {
      plants,
      dashboard_cold_ms: ms(cold.total),
      dashboard_warm_p50_ms: ms(
        p(
          warm.map((w) => w.total),
          0.5,
        ),
      ),
      dashboard_warm_p95_ms: ms(p95),
      p95_per_request_ms: perPath,
      other_lists_ms: others,
      limit_ms: LIMIT_MS,
      result: ok ? 'CUMPLE' : 'NO CUMPLE',
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

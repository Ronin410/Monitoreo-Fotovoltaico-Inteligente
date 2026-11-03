import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnvOrExit } from '@pv/config';
import {
  companyMonthlyCost,
  costPricesSchema,
  currentPeriod,
  fixedMonthlyTotal,
  shiftPeriod,
  type CostPrices,
} from '@pv/core';
import { assertAppRoleIsSafe, createPrismaClient } from '@pv/db';
import { measureCompanyUsage } from '../costs-usage.js';

// Hoja de costos por empresa con el consumo medido (docs/costos.md). Uso, en la Shell de pv-api:
//   pnpm costs:report                                   # solo consumo
//   pnpm costs:report --prices docs/costos-precios.json # consumo y costo en USD
// Opciones: --period YYYY-MM (uso de IA; por defecto el mes pasado), --days N (ventana de lecturas
// y correos; 30), --pdf-kb N (tamaño promedio de un PDF de reporte; 150), --json.

const { values } = parseArgs({
  options: {
    prices: { type: 'string' },
    period: { type: 'string' },
    days: { type: 'string', default: '30' },
    'pdf-kb': { type: 'string', default: '150' },
    json: { type: 'boolean', default: false },
  },
});

const env = loadEnvOrExit();
const now = new Date();
const period = values.period ?? shiftPeriod(currentPeriod(now, env.DEFAULT_TIMEZONE), -1);
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
  console.error('--period debe ser YYYY-MM');
  process.exit(1);
}
const days = Number(values.days);
const pdfKb = Number(values['pdf-kb']);
if (!Number.isInteger(days) || days < 1 || !(pdfKb >= 0)) {
  console.error('--days debe ser un entero positivo y --pdf-kb un número');
  process.exit(1);
}
let prices: CostPrices | null = null;
if (values.prices) {
  const parsed = costPricesSchema.safeParse(
    // pnpm corre el script desde apps/worker; la ruta es relativa a donde se escribió el comando.
    JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), values.prices), 'utf8')),
  );
  if (!parsed.success) {
    console.error(
      `Archivo de precios inválido: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
    process.exit(1);
  }
  prices = parsed.data;
}

const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
await assertAppRoleIsSafe(db);
const companies = await measureCompanyUsage(db, serviceDb, now, {
  period,
  days,
  models: { chat: env.LLM_MODEL_CHAT, fast: env.LLM_MODEL_FAST },
  reportPdfKb: pdfKb,
});
const [size] = await serviceDb.$queryRaw<{ bytes: bigint }[]>`
  SELECT pg_database_size(current_database())::bigint AS bytes`;
await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);

const totalPlants = companies.reduce((a, c) => a + c.plants, 0);
const rows = companies.map((c) => ({
  ...c,
  cost: prices ? companyMonthlyCost(c, prices, totalPlants) : null,
}));
const report = {
  generated_at: now.toISOString(),
  ai_period: period,
  window_days: days,
  database_mb: Math.round(Number(size?.bytes ?? 0n) / 1024 / 1024),
  total_plants: totalPlants,
  prices_reviewed_at: prices?.reviewed_at ?? null,
  fixed_monthly_usd: prices ? fixedMonthlyTotal(prices) : null,
  companies: rows,
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const n = (x: number) => x.toLocaleString('es-MX');
  const tokens = (c: (typeof rows)[number]) =>
    c.ai.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0);
  console.log(`Hoja de costos PV-IoT · IA de ${period} · lecturas y correos de ${days} días`);
  console.log(`Base de datos: ${n(report.database_mb)} MB · plantas: ${n(totalPlants)}\n`);
  const header = [
    'Empresa',
    'Estado',
    'Plantas',
    'Lecturas/día',
    'Tokens IA',
    'Correos/mes',
    'Archivos MB',
  ];
  if (prices) header.push('IA USD', 'Fijos USD', 'Total USD', 'USD/planta');
  console.log(`| ${header.join(' | ')} |\n|${header.map(() => '---').join('|')}|`);
  for (const c of rows) {
    const cells = [
      c.name,
      c.status,
      n(c.plants),
      n(c.readingsPerDay),
      n(tokens(c)),
      n(c.emails),
      (c.storageBytes / 1024 / 1024).toFixed(1),
    ];
    if (c.cost) {
      cells.push(
        c.cost.ai.toFixed(2),
        c.cost.fixedShare.toFixed(2),
        c.cost.total.toFixed(2),
        c.cost.perPlant === null ? '—' : c.cost.perPlant.toFixed(2),
      );
    }
    console.log(`| ${cells.join(' | ')} |`);
  }
  if (!prices) {
    console.log(
      '\nSin --prices solo se muestra el consumo. Ver docs/costos.md para llenar los precios.',
    );
  } else {
    const unpriced = [...new Set(rows.flatMap((r) => r.cost?.unpricedModels ?? []))];
    if (unpriced.length) console.log(`\nModelos sin precio en el archivo: ${unpriced.join(', ')}`);
    console.log(
      `\nPrecios revisados el ${prices.reviewed_at}; costos fijos: ${fixedMonthlyTotal(prices).toFixed(2)} USD/mes.`,
    );
    const missing = Object.entries(prices.fixed_monthly).filter(([, v]) => v === 0);
    if (missing.length) {
      console.log(`Costos fijos en 0 (¿faltan por llenar?): ${missing.map(([k]) => k).join(', ')}`);
    }
  }
}

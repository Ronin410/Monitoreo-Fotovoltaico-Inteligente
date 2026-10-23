import { loadEnvOrExit } from '@pv/config';
import { createPrismaClient } from '@pv/db';
import { evaluateAlertQuality, GOALS } from '../eval/alerts-eval.js';
import { DEMO_SLUGS } from '../seed/demo.js';

// pnpm eval:alerts — calidad de detección de alertas sobre la semilla demo (specs/12 §4).
// Termina con código 1 si no se cumplen las metas.

const env = loadEnvOrExit();
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
try {
  const companies = await serviceDb.company.findMany({
    where: { slug: { in: Object.values(DEMO_SLUGS) } },
    select: { id: true },
  });
  if (companies.length === 0) {
    console.error('No hay semilla demo en esta base: corre primero pnpm db:seed:demo.');
    process.exit(1);
  }
  const report = await evaluateAlertQuality(
    db,
    companies.map((c) => c.id),
    new Date(),
  );
  console.log('Escenarios inyectados:');
  console.table(
    report.scenarios.map((s) => ({
      planta: s.plant,
      escenario: s.kind,
      detectable_desde: s.detectableFrom,
      detectada: s.detected,
      retraso:
        s.delay === null
          ? '—'
          : `${s.delay} ${s.kind === 'offline' ? 'h' : s.delay === 1 ? 'día' : 'días'}`,
      en_meta: s.withinGoal,
    })),
  );
  console.log('Recall por escenario (meta ≥ %d %%):', GOALS.recallPct);
  console.table(report.recall);
  console.log(
    `Plantas normales con alertas falsas: ${report.falsePlantsPct} % de ${report.normalPlants} (meta < ${GOALS.falsePlantsPct} %)`,
  );
  if (report.falseAlerts.length) console.table(report.falseAlerts);
  if (report.passed) {
    console.log('\nResultado: cumple las metas de specs/12 §4.');
  } else {
    console.log('\nResultado: NO cumple las metas:');
    for (const f of report.failures) console.log(`- ${f}`);
    process.exitCode = 1;
  }
} finally {
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
}

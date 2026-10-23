import { createAiConfig } from '@pv/ai';
import { loadEnvOrExit } from '@pv/config';
import { createPrismaClient } from '@pv/db';
import { chatAsker, collectFacts, evaluateAssistant, GOALS } from '../eval/assistant-eval.js';
import { DEMO_SLUGS } from '../seed/demo.js';

// pnpm eval:assistant — respuestas del asistente sobre la semilla demo (specs/12 §5), con el
// modelo real (LLM_PROVIDER=anthropic). Termina con código 1 si no se cumplen las metas.

const env = loadEnvOrExit();
if (env.LLM_PROVIDER !== 'anthropic') {
  console.error(
    'eval:assistant necesita el modelo real: LLM_PROVIDER=anthropic y ANTHROPIC_API_KEY.',
  );
  process.exit(1);
}
const db = createPrismaClient(env.DATABASE_URL);
const serviceDb = createPrismaClient(env.SERVICE_DATABASE_URL);
try {
  const [a, b] = await Promise.all(
    [DEMO_SLUGS.a, DEMO_SLUGS.b].map((slug) => serviceDb.company.findUnique({ where: { slug } })),
  );
  if (!a || !b) {
    console.error('No hay semilla demo en esta base: corre primero pnpm db:seed:demo.');
    process.exit(1);
  }
  const now = new Date();
  const facts = await collectFacts(db, a.id, b.id, now);
  console.log(`Evaluando ${env.LLM_MODEL_CHAT} sobre ${a.name}…`);
  const report = await evaluateAssistant(facts, chatAsker(db, a.id, createAiConfig(env), now));
  console.table(
    report.results.map((r) => ({
      caso: r.id,
      pregunta: r.question.slice(0, 60),
      herramientas: r.tools.join(', ') || '—',
      ok: r.passed ? 'sí' : 'NO',
      motivo: r.reason,
    })),
  );
  console.log(
    `Correctas: ${report.correctPct} % (meta ≥ ${GOALS.correctPct} %). Aislamiento (casos 11 y 12): ${report.isolationPct} % (meta ${GOALS.isolationPct} %).`,
  );
  if (!report.passed) {
    console.log('Resultado: NO cumple las metas de specs/12 §5.');
    process.exitCode = 1;
  } else console.log('Resultado: cumple las metas de specs/12 §5.');
} finally {
  await Promise.all([db.$disconnect(), serviceDb.$disconnect()]);
}

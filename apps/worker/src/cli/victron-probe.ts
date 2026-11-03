import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { VrmApiError, VrmClient } from '@pv/adapters';

// Diagnóstico de la VRM API de Victron con una cuenta real (docs/fabricantes/victron-vrm.md §5).
// La documentación no dice qué códigos trae la serie solar, si cada punto es energía o potencia,
// ni la unidad de sus timestamps. Este comando hace solo consultas de lectura documentadas y guarda
// las respuestas (sin el token) para confirmarlo y grabarlas como ejemplos de prueba.
//
// Uso (en la Shell de pv-api o en una computadora con el repositorio):
//   pnpm victron:probe --site <id de la instalación>
// Pide el token de acceso por la entrada estándar; no se guarda ni se imprime.
// En stats no se mandan `start` ni `end`: se usan sus valores por omisión (el último día), así no
// se supone la unidad de los timestamps.

const { values } = parseArgs({ options: { site: { type: 'string' } } });
const idSite = Number(values.site);
if (!Number.isInteger(idSite) || idSite <= 0) {
  console.error('Indique la instalación: pnpm victron:probe --site <idSite>');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stderr });
const token = (await rl.question('Token de acceso de VRM: ')).trim();
rl.close();
if (token.length < 10) {
  console.error('Token vacío o demasiado corto');
  process.exit(1);
}

const client = new VrmClient(token);
const pause = () => new Promise((r) => setTimeout(r, 500)); // muy por debajo de ~3 por segundo
const result: Record<string, unknown> = { generated_at: new Date().toISOString(), id_site: idSite };

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    result[name] = await fn();
    console.error(`✓ ${name}`);
  } catch (err) {
    result[name] = {
      error:
        err instanceof VrmApiError
          ? err.message
          : `${(err as Error).name}: ${(err as Error).message}${
              (err as { cause?: { code?: string } }).cause?.code
                ? ` (${(err as { cause: { code: string } }).cause.code})`
                : ''
            }`,
    };
    console.error(`✗ ${name}: ${(result[name] as { error: string }).error}`);
  }
  await pause();
}

let idUser: number | null = null;
await step('me', async () => {
  const me = await client.me();
  idUser = me.id;
  return { id: me.id };
});
if (idUser !== null) {
  const user = idUser;
  await step('installation', async () => {
    const site = await client.installation(user, idSite);
    // Sin datos personales: solo lo técnico.
    return site && { idSite: site.idSite, pvMax: site.pvMax, timezone: site.timezone };
  });
}
for (const type of ['solar_yield', 'live_feed', 'kwh']) {
  await step(`stats_${type}_15mins`, () =>
    client.get(`/installations/${idSite}/stats`, { type, interval: '15mins' }),
  );
}
await step('overallstats_solar_yield', () =>
  client.get(`/installations/${idSite}/overallstats`, { type: 'solar_yield' }),
);
await step('diagnostics', () => client.get(`/installations/${idSite}/diagnostics`, { count: 200 }));
await step('data_attributes', () => client.get('/data-attributes'));

const file = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  `victron-probe-${idSite}-${new Date().toISOString().slice(0, 10)}.json`,
);
const json = JSON.stringify(result, null, 2);
if (json.includes(token)) {
  console.error('La respuesta contiene el token; no se guarda el archivo.');
  process.exit(1);
}
writeFileSync(file, json);

// Resumen: qué series trae cada tipo, cuántos puntos y los primeros.
for (const [name, value] of Object.entries(result)) {
  if (!name.startsWith('stats_')) continue;
  const records = (value as { records?: Record<string, unknown> }).records;
  if (!records || typeof records !== 'object') continue;
  console.log(`\n${name}`);
  for (const [code, series] of Object.entries(records)) {
    const points = Array.isArray(series) ? series : [];
    console.log(
      `  ${code}: ${points.length} puntos; primeros ${JSON.stringify(points.slice(0, 2))}`,
    );
  }
}
console.log(`\nRespuestas guardadas en ${file}`);

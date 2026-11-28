import {
  BASELINE_MIN_DAYS,
  BASELINE_WINDOW_DAYS,
  cellTemperatureC,
  companySettingsSchema,
  DEFAULT_BASELINE,
  DEFAULT_SETTINGS,
  F_TEMP_MAX,
  F_TEMP_MIN,
  LARGE_PLANT_KWP,
  SOILING_MIN_POINTS,
  TELEMETRY_RETENTION_MONTHS,
  temperatureFactor,
} from '@pv/core';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';

// Manual del superadministrador: qué calcula la plataforma, con qué datos y qué se puede ajustar
// (docs/calculos-y-configuracion.md; specs/05 y 06 mandan si hay diferencias). Los valores por
// defecto, los rangos y las constantes se leen de @pv/core para que el manual no se desactualice.

const T = DEFAULT_SETTINGS.thresholds;
const D = DEFAULT_SETTINGS.defaults;

const n = (v: number, digits = 2) => v.toLocaleString('es-MX', { maximumFractionDigits: digits });

/** Rango permitido de un ajuste, leído del esquema de validación. */
function range(
  section: 'thresholds' | 'defaults',
  key: string,
  { exclusiveMin = false } = {},
): string {
  const field = (
    companySettingsSchema.shape[section].shape as Record<
      string,
      { minValue?: number | null; maxValue?: number | null }
    >
  )[key];
  const min = field?.minValue;
  const max = field?.maxValue;
  const hasMin = min != null && Number.isFinite(min);
  const hasMax = max != null && Number.isFinite(max);
  if (exclusiveMin && hasMin) {
    return hasMax ? `mayor a ${n(min)}, hasta ${n(max)}` : `mayor a ${n(min)}`;
  }
  if (hasMin && hasMax) return `${n(min)} – ${n(max)}`;
  if (hasMax) return `hasta ${n(max)}`;
  return '—';
}

/** Pesos con dos decimales. */
const mxn = (v: number) => `$${v.toFixed(2)}`;

// Ejemplo del spec 05 (Caso A): 5 kWp, 900 W/m², 38 °C, 3.2 kWh medidos.
const EX = (() => {
  const kwp = 5;
  const g = 900;
  const tCell = cellTemperatureC(38, g, D.noct_c);
  const fTemp = temperatureFactor(tCell, D.gamma_pct_per_c);
  const eStc = (kwp * g) / 1000;
  const eExp = eStc * fTemp;
  return { tCell, fTemp, eStc, eExp, pr: 3.2 / eStc, prTemp: 3.2 / eExp };
})();
const LAVAR_UMBRAL = 100 - T.soiling_deviation_pct;

const SECTIONS = [
  { id: 'datos', label: 'Datos' },
  { id: 'diario', label: 'Cálculo diario' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'reporte', label: 'Reporte mensual' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'calendario', label: 'Calendario' },
  { id: 'estandares', label: 'Estándares' },
  { id: 'pendientes', label: 'Preguntas abiertas' },
] as const;

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900';

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${card} scroll-mt-4`}>
      <h2 id={`${id}-title`} className="flex items-baseline gap-2 text-xl font-semibold">
        <span className="font-mono text-sm text-amber-700 dark:text-amber-400">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-base font-semibold">{children}</h3>;
}

function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p
      className={`max-w-prose text-sm leading-relaxed ${muted ? 'text-slate-600 dark:text-slate-400' : ''}`}
    >
      {children}
    </p>
  );
}

function List({ items, ordered }: { items: ReactNode[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag
      className={`flex max-w-prose flex-col gap-1.5 pl-5 text-sm leading-relaxed ${ordered ? 'list-decimal' : 'list-disc'}`}
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-r-lg border-l-4 border-amber-500 bg-slate-50 px-4 py-3 font-mono text-[13px] leading-relaxed dark:bg-slate-800/60">
      {children}
    </pre>
  );
}

function Example({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-prose flex-col gap-1 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-slate-600 dark:text-slate-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-200 align-top dark:border-slate-800">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j > 0 ? 'tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEVERITY = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  ok: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
} as const;

function Pill({ tone, children }: { tone: keyof typeof SEVERITY; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${SEVERITY[tone]}`}
    >
      {children}
    </span>
  );
}

export function ManualView() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Manual"
        subtitle="Qué calcula la plataforma, con qué datos y qué se puede ajustar. Los valores por defecto se leen del sistema, así que siempre están al día."
      />

      <nav aria-label="Secciones del manual">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex rounded-full border border-slate-300 px-3 py-1 text-sm hover:border-amber-500 dark:border-slate-700"
              >
                {i + 1} · {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="datos" number={1} title="De dónde salen los datos">
        <Table
          head={['Dato', 'Fuente', 'Cada cuánto']}
          rows={[
            [
              'Producción del inversor',
              'Portal de cada fabricante: Victron; Enphase y GoodWe listos para probar; Growatt en integración',
              'Cada 15 min con sol; Enphase cada 2 h (cobra por consulta)',
            ],
            [
              'Clima por hora',
              'Open-Meteo: irradiancia sobre el plano de los paneles (con la inclinación y orientación de la planta), temperatura, nubosidad y lluvia',
              'Cada hora',
            ],
            [
              'Eventos de la planta',
              'Lavados y reparaciones (al cerrar tickets) y "lavado por lluvia" (automático)',
              'Cuando ocurren',
            ],
          ]}
        />
        <H3>Normalización de la producción</H3>
        <P>
          Todo se guarda en intervalos de 15 minutos: potencia promedio (kW) y energía del intervalo
          (kWh).
        </P>
        <List
          items={[
            <>
              Con <strong>contador de energía del día</strong>, la energía del intervalo es la
              diferencia del contador, considerando el reinicio a medianoche.
            </>,
            'Un hueco de hasta 1 hora se rellena repartiendo esa diferencia entre los intervalos faltantes (quedan marcados como "rellenados").',
            'Sin contador: energía = potencia × 0.25 h.',
            'De noche no se consulta al fabricante: solo dentro de la ventana de sol (amanecer − 30 min a atardecer + 30 min).',
          ]}
        />
      </Section>

      <Section id="diario" number={2} title="Cálculo diario">
        <P muted>Cada noche a las 22:00, en la zona horaria de cada empresa.</P>
        <H3>2.1 Por cada hora del día</H3>
        <Formula>{`G        = irradiancia promedio sobre los paneles (W/m²)
T_celda  = T_ambiente + (NOCT − 20) / 800 × G
F_temp   = 1 + (γ / 100) × (T_celda − 25)      limitado a ${n(F_TEMP_MIN)} – ${n(F_TEMP_MAX)}
E_stc    = kWp × G / 1000                      energía teórica estándar
E_esp    = E_stc × F_temp                      energía esperada, corregida por calor
E_real   = energía medida por el inversor en esa hora`}</Formula>
        <List
          items={[
            <>
              <strong>Por qué hora por hora:</strong> a mediodía en Culiacán la celda pasa de 65 °C
              y pierde mucho rendimiento; a las 8:00 casi no. Un solo factor diario daría falsas
              alarmas.
            </>,
            <>
              Una hora está <strong>cubierta</strong> si tiene clima y al menos 3 de sus 4
              intervalos de 15 min.
            </>,
          ]}
        />

        <H3>2.2 Resultado del día</H3>
        <Table
          head={['Indicador', 'Fórmula', 'Qué significa']}
          rows={[
            ['Energía del día', 'Suma de la energía medida', 'Lo que se reporta al cliente'],
            [
              'Rendimiento específico',
              'Energía ÷ kWp',
              'kWh por kWp instalado; compara plantas de distinto tamaño',
            ],
            ['PR', 'Σ E_real ÷ Σ E_stc (horas cubiertas)', 'Rendimiento sin corregir por calor'],
            [
              <strong key="k">PR corregido</strong>,
              'Σ E_real ÷ Σ E_esp (horas cubiertas)',
              <>
                <strong>El indicador principal:</strong> cuánto entregó de lo que debía según el sol
                y la temperatura
              </>,
            ],
            [
              'Completitud de datos',
              '100 × E_stc de horas cubiertas ÷ E_stc de todas las horas con sol',
              'Ponderada por el sol: perder el mediodía pesa más que perder las 7:00',
            ],
          ]}
        />
        <Example title="Ejemplo: planta de 5 kWp, una hora a mediodía">
          <span>
            G = 900 W/m² y 38 °C → T_celda = {n(EX.tCell, 1)} °C, F_temp = {n(EX.fTemp, 3)}, E_stc ={' '}
            {n(EX.eStc)} kWh, E_esp = {n(EX.eExp)} kWh.
          </span>
          <span>
            Si produjo 3.2 kWh: PR = {n(EX.pr * 100, 0)} % (parece mal),{' '}
            <strong>PR corregido = {n(EX.prTemp * 100, 0)} %</strong> (está bien).
          </span>
        </Example>

        <H3>2.3 Día válido</H3>
        <P>Un día solo se usa para la línea base, las vecinas y la suciedad si cumple todo:</P>
        <Table
          head={['Condición', 'Por defecto', 'Si no se cumple']}
          rows={[
            [
              'Irradiación del día',
              `≥ ${n(T.min_valid_irradiation_kwh_m2)} kWh/m²`,
              'Poca irradiación',
            ],
            ['Completitud de datos', `≥ ${n(T.min_data_completeness_pct)} %`, 'Datos incompletos'],
            ['Hubo lecturas del inversor', '—', 'Sin datos'],
            ['Hubo clima', '—', 'Sin clima'],
          ]}
        />

        <H3>2.4 Línea base: la planta limpia y sana</H3>
        <List
          items={[
            <>
              <strong>Propia:</strong> el percentil 80 del PR corregido de los días válidos de los
              últimos <strong>{BASELINE_WINDOW_DAYS} días</strong>, sin los días con caída brusca.
              Necesita al menos <strong>{BASELINE_MIN_DAYS} días válidos</strong>.
            </>,
            'Se usa el percentil 80 y no el promedio porque en temporada seca la suciedad baja el rendimiento poco a poco, y un promedio "aprendería" la suciedad como normal.',
            <>
              <strong>Planta nueva</strong> (menos de {BASELINE_MIN_DAYS} días): la mediana de las
              líneas base de sus vecinas. Sin vecinas, <strong>{n(DEFAULT_BASELINE)}</strong>.
            </>,
          ]}
        />

        <H3>2.5 Desviación</H3>
        <Formula>{'desviación % = 100 × (línea base − PR corregido) ÷ línea base'}</Formula>
        <P>
          Positiva quiere decir que la planta rinde <strong>por debajo</strong> de lo normal para
          ella.
        </P>

        <H3>2.6 Comparación con plantas vecinas</H3>
        <List
          items={[
            <>
              Vecinas: plantas de la misma empresa, con día válido, a{' '}
              <strong>{n(T.neighbor_radius_km)} km</strong> o menos. Si son menos de{' '}
              <strong>{T.neighbor_min_count}</strong>, se usan las del mismo código postal.
            </>,
            'Nunca se comparan plantas de otras empresas.',
          ]}
        />
        <Formula>{`índice de vecinas = (PR corregido ÷ línea base de la planta)
                    ÷ mediana de lo mismo en sus vecinas`}</Formula>
        <P>
          Cerca de 1.0, se comporta igual que su zona. Por debajo de 0.88, rinde peor que sus
          vecinas ese día y probablemente no es el clima.
        </P>

        <H3>2.7 Suciedad y fecha sugerida de lavado</H3>
        <List
          ordered
          items={[
            <>
              Se toma el último <strong>reinicio</strong>: un lavado, una reparación o una lluvia de{' '}
              <strong>{n(T.rain_reset_mm)} mm</strong> o más (se registra sola).
            </>,
            <>
              Con los días válidos desde ese reinicio (mínimo <strong>{SOILING_MIN_POINTS}</strong>)
              se traza una recta del rendimiento relativo (PR corregido ÷ línea base, en %) contra
              los días.
            </>,
            <>
              El umbral para lavar es{' '}
              <strong>
                100 − {n(T.soiling_deviation_pct)} = {n(LAVAR_UMBRAL)} %
              </strong>
              .
            </>,
            `Días para lavar: si hoy ya está en ${n(LAVAR_UMBRAL)} % o menos, 0 (lavar ya). Si baja más de 0.05 % por día, (valor de hoy − ${n(LAVAR_UMBRAL)}) ÷ caída diaria, redondeado hacia arriba; más de 120 días no se muestra. Si no baja, no hay fecha.`,
            'Confianza: alta si la recta explica bien los puntos (R² ≥ 0.7) y hay 14 días o más; media si R² ≥ 0.4; baja en otro caso.',
          ]}
        />
        <Example title="Ejemplo">
          <span>
            Hoy 94 %, cae 0.3 % por día → (94 − {n(LAVAR_UMBRAL)}) ÷ 0.3 ={' '}
            <strong>{Math.ceil((94 - LAVAR_UMBRAL) / 0.3)} días</strong> para lavar.
          </span>
        </Example>

        <H3>2.8 Estado del día de la planta</H3>
        <P>Se evalúa en este orden; gana el primero que se cumple:</P>
        <List
          ordered
          items={[
            <>
              Sin clima → <Pill tone="info">sin datos</Pill>
            </>,
            <>
              Sin lecturas con sol → <Pill tone="critical">fuera de línea</Pill>
            </>,
            <>
              Alerta crítica abierta → <Pill tone="critical">crítico</Pill>
            </>,
            <>
              Desviación &gt; {n(T.soiling_deviation_pct)} %, lavado en 7 días o menos, o alerta de
              advertencia abierta → <Pill tone="warning">advertencia</Pill>
            </>,
            <>
              Si no → <Pill tone="ok">bien</Pill>
            </>,
          ]}
        />
      </Section>

      <Section id="alertas" number={3} title="Alertas">
        <P>Se evalúan después del cálculo nocturno, salvo "sin datos", que se revisa cada hora.</P>
        <H3>3.1 Evento de zona</H3>
        <P>
          Si en un grupo de al menos <strong>{T.neighbor_min_count}</strong> plantas cercanas el{' '}
          <strong>{n(T.zone_event_pct)} %</strong> o más bajan más de {n(T.soiling_deviation_pct)} %
          el mismo día, se marca como evento de zona: fue el clima (polvo, humo, nubes), no una
          falla. Ese día no cuenta para caída brusca ni para suciedad.
        </P>
        <H3>3.2 Reglas</H3>
        <Table
          head={['Alerta', 'Se abre cuando', 'Severidad', 'Se cierra sola cuando']}
          rows={[
            [
              <strong key="k">Sin datos</strong>,
              `Más de ${n(T.offline_hours)} horas con sol sin lecturas. Si la causa es la conexión con el fabricante (llaves mal, portal caído), se muestra como "problema de conexión" y no como alerta`,
              <Pill key="p" tone="critical">
                Crítica
              </Pill>,
              'Vuelven las lecturas',
            ],
            [
              <strong key="k">Caída brusca</strong>,
              `Desviación ≥ ${n(T.sudden_drop_pct)} % y el día válido anterior estaba bien (< 15 %)`,
              <Pill key="p" tone="critical">
                Crítica
              </Pill>,
              'Desviación < 10 % dos días válidos',
            ],
            [
              <strong key="k">Caída parcial</strong>,
              'Desviación ≥ 20 % dos días válidos seguidos, venía bien (< 10 %) y rinde peor que sus vecinas (índice < 0.8). Detecta, por ejemplo, 1 de 3 cadenas de paneles caída (~33 %)',
              <Pill key="p" tone="warning">
                Advertencia
              </Pill>,
              'Igual que la anterior',
            ],
            [
              <strong key="k">Suciedad</strong>,
              `Desviación > ${n(T.soiling_deviation_pct)} % en ${T.soiling_consecutive_days} días válidos seguidos (dentro de 7 días), sin lluvia ≥ ${n(T.rain_reset_mm)} mm y con tendencia a la baja`,
              <Pill key="p" tone="warning">
                Advertencia
              </Pill>,
              'Lavado y el siguiente día válido < 5 %, o < 5 % dos días válidos',
            ],
            [
              <strong key="k">Lavar pronto</strong>,
              'Faltan de 1 a 7 días para lavar, con confianza media o alta',
              <Pill key="p" tone="info">
                Informativa
              </Pill>,
              'Se abre la de suciedad o hay un lavado',
            ],
          ]}
        />
        <List
          items={[
            <>
              <strong>
                Si se lavó y la desviación sigue arriba de {n(T.soiling_deviation_pct)} %
              </strong>{' '}
              en los 2 días siguientes, la alerta de suciedad sigue abierta con la nota "el lavado
              no recuperó": la causa es otra (sombra, degradación, falla).
            </>,
            <>
              <strong>Plantas con batería o con límite de inyección:</strong> no reciben caída
              brusca, suciedad ni lavar pronto, y no sirven de vecinas, porque el inversor puede
              producir menos a propósito. "Sin datos" sí aplica.
            </>,
            <>
              <strong>Pérdida estimada por día</strong> (en el detalle de la alerta): con bajo
              rendimiento, energía esperada × (línea base − PR corregido); sin producción, energía
              esperada × línea base. Se multiplica por la tarifa (la del cliente o la de la empresa)
              para dar el monto en pesos.
            </>,
          ]}
        />
        <H3>3.3 Prioridad de tickets</H3>
        <Table
          head={['Severidad de la alerta', 'Prioridad base']}
          rows={[
            [
              <Pill key="p" tone="critical">
                Crítica
              </Pill>,
              'Alta',
            ],
            [
              <Pill key="p" tone="warning">
                Advertencia
              </Pill>,
              'Normal',
            ],
            [
              <Pill key="p" tone="info">
                Informativa
              </Pill>,
              'Baja',
            ],
          ]}
        />
        <P>
          Sube un nivel en plantas de <strong>alto impacto</strong>: comerciales, industriales o de{' '}
          <strong>{LARGE_PLANT_KWP} kWp o más</strong>. La bandeja "por prioridad" ordena por
          severidad, luego por tipo de instalación y luego por tamaño.
        </P>
        <P>
          <strong>Tiempos de atención:</strong> espera = inicio − creación; trabajo = resuelto −
          inicio; total = resuelto − creación. Se muestran el promedio y la mediana de 7, 30 o 90
          días.
        </P>
      </Section>

      <Section id="reporte" number={4} title="Reporte mensual del cliente">
        <Table
          head={['Dato', 'Cálculo']}
          rows={[
            ['Energía del mes', 'Suma de la energía diaria de sus plantas'],
            ['Cambio contra el mes anterior', '(este mes − anterior) ÷ anterior'],
            [
              <strong key="k">Ahorro estimado</strong>,
              `Energía × tarifa. Usa la tarifa del cliente o, si no tiene, la de la empresa (${mxn(D.tariff_mxn_per_kwh)}/kWh por defecto)`,
            ],
            [
              'CO₂ evitado',
              `Energía × factor de emisión (${n(D.co2_kg_per_kwh, 3)} kg/kWh por defecto; falta confirmar el vigente para México)`,
            ],
            [
              'Cobertura del consumo',
              'Energía ÷ consumo mensual promedio del cliente, si se capturó',
            ],
            ['PR corregido por planta', 'Energía de días válidos ÷ energía esperada de esos días'],
            ['Disponibilidad', 'Horas con sol con al menos una lectura ÷ horas con sol'],
            ['Días nublados / con lluvia', 'Nubosidad promedio ≥ 60 % / lluvia ≥ 1 mm'],
          ]}
        />
        <P muted>
          El ahorro con precio fijo por kWh sirve para casas. Para negocios con tarifas de CFE por
          horario hace falta la etapa 2, pendiente de spec.
        </P>
      </Section>

      <Section id="configuracion" number={5} title="Qué se puede configurar">
        <H3>5.1 Umbrales de cada empresa</H3>
        <P muted>Configuración → Umbrales. Solo el administrador de la empresa.</P>
        <Table
          head={['Ajuste', 'Por defecto', 'Rango', 'Para qué sirve']}
          rows={[
            [
              'Desviación por suciedad',
              `${n(T.soiling_deviation_pct)} %`,
              range('thresholds', 'soiling_deviation_pct'),
              'Cuándo se considera sucia; define el umbral de lavado y el estado "advertencia"',
            ],
            [
              'Días seguidos para suciedad',
              String(T.soiling_consecutive_days),
              range('thresholds', 'soiling_consecutive_days'),
              'Días válidos seguidos antes de alertar',
            ],
            [
              'Caída brusca',
              `${n(T.sudden_drop_pct)} %`,
              range('thresholds', 'sudden_drop_pct'),
              'Desviación que abre la alerta crítica',
            ],
            [
              'Horas sin datos',
              `${n(T.offline_hours)} h`,
              range('thresholds', 'offline_hours'),
              'Horas con sol sin lecturas antes de "sin datos"',
            ],
            [
              'Lluvia que limpia',
              `${n(T.rain_reset_mm)} mm`,
              range('thresholds', 'rain_reset_mm'),
              'Lluvia que cuenta como lavado natural',
            ],
            [
              'Irradiación mínima',
              `${n(T.min_valid_irradiation_kwh_m2)} kWh/m²`,
              range('thresholds', 'min_valid_irradiation_kwh_m2'),
              'Días muy nublados no se usan para comparar',
            ],
            [
              'Completitud mínima',
              `${n(T.min_data_completeness_pct)} %`,
              range('thresholds', 'min_data_completeness_pct'),
              'Días con muchos huecos no se usan para comparar',
            ],
            [
              'Radio de vecinas',
              `${n(T.neighbor_radius_km)} km`,
              range('thresholds', 'neighbor_radius_km'),
              'Qué tan lejos se buscan plantas para comparar',
            ],
            [
              'Mínimo de vecinas',
              String(T.neighbor_min_count),
              range('thresholds', 'neighbor_min_count'),
              'Cuántas hacen falta para comparar y para el evento de zona',
            ],
            [
              'Evento de zona',
              `${n(T.zone_event_pct)} %`,
              range('thresholds', 'zone_event_pct'),
              '% de plantas de la zona que deben bajar a la vez',
            ],
          ]}
        />

        <H3>5.2 Valores técnicos por defecto de cada empresa</H3>
        <P muted>Se usan al dar de alta plantas y en los reportes.</P>
        <Table
          head={['Ajuste', 'Por defecto', 'Rango', 'Nota']}
          rows={[
            [
              'NOCT del panel',
              `${n(D.noct_c)} °C`,
              range('defaults', 'noct_c'),
              'Temperatura nominal de operación de la celda',
            ],
            [
              'Coeficiente de temperatura (γ)',
              `${n(D.gamma_pct_per_c)} %/°C`,
              range('defaults', 'gamma_pct_per_c'),
              'De la hoja de datos del panel',
            ],
            ['Inclinación', `${n(D.tilt_deg)}°`, range('defaults', 'tilt_deg'), ''],
            [
              'Orientación (azimut)',
              `${n(D.azimuth_deg)}°`,
              range('defaults', 'azimuth_deg'),
              '180 = sur, 90 = este, 270 = oeste',
            ],
            [
              'Tarifa',
              `${mxn(D.tariff_mxn_per_kwh)}/kWh`,
              range('defaults', 'tariff_mxn_per_kwh', { exclusiveMin: true }),
              'Para el ahorro estimado',
            ],
            [
              'Factor de CO₂',
              `${n(D.co2_kg_per_kwh, 3)} kg/kWh`,
              range('defaults', 'co2_kg_per_kwh'),
              'Falta confirmar el vigente para México',
            ],
          ]}
        />

        <H3>5.3 Otros ajustes de la empresa</H3>
        <List
          items={[
            <>
              <strong>Notificaciones:</strong> correos que reciben las alertas y el resumen diario
              (hasta 20), y si los reportes mensuales se envían solos al cliente.
            </>,
            <>
              <strong>Perfil:</strong> nombre, color de marca, logo y <strong>zona horaria</strong>{' '}
              (define a qué hora corren el cálculo nocturno y el resumen diario).
            </>,
            <>
              <strong>Integraciones:</strong> llaves de GoodWe y de Enphase de la empresa, cifradas;
              nunca se vuelven a mostrar.
            </>,
            'Se guarda solo lo que la empresa cambió; "Restablecer" vuelve a los valores por defecto.',
          ]}
        />

        <H3>5.4 Datos de cada planta</H3>
        <Table
          head={['Dato', 'Para qué sirve']}
          rows={[
            [
              'Capacidad (kWp)',
              `Energía teórica, rendimiento específico y alto impacto (≥ ${LARGE_PLANT_KWP} kWp)`,
            ],
            ['Inclinación y orientación', 'Irradiancia sobre los paneles'],
            ['NOCT y γ', 'Corrección por temperatura'],
            [
              'Ubicación y código postal',
              'Clima, ventana de sol y vecinas. Sin ubicación la planta no se lee',
            ],
            ['Tipo de instalación', 'Casa, negocio o industria: prioridad de alertas y tickets'],
            [
              'Con batería / límite de inyección',
              'Evita alertas falsas por producción limitada a propósito',
            ],
            ['Marca y credenciales del inversor', 'Cómo se leen sus datos (cifradas)'],
            ['Estado (activa / pausada)', 'Una planta pausada no se lee ni genera alertas'],
          ]}
        />

        <H3>5.5 Datos de cada cliente</H3>
        <P>
          Tarifa propia ($/kWh, en lugar de la de la empresa), consumo y recibo mensual promedio
          (para la cobertura del consumo) y correo para el reporte mensual.
        </P>

        <H3>5.6 Lo que ajusta el superadministrador</H3>
        <P>
          En Empresas: estado de cada empresa (activa o suspendida), plan y presupuesto mensual del
          asistente de IA (2,000,000 tokens por defecto).
        </P>

        <H3>5.7 Fijos en el código</H3>
        <P muted>Cambiarlos requiere desarrollo.</P>
        <Table
          head={['Valor', 'Cuánto']}
          rows={[
            [
              'Ventana de la línea base / mínimo de días',
              `${BASELINE_WINDOW_DAYS} días / ${BASELINE_MIN_DAYS} días`,
            ],
            ['Línea base sin datos ni vecinas', n(DEFAULT_BASELINE)],
            ['Límites del factor de temperatura', `${n(F_TEMP_MIN)} – ${n(F_TEMP_MAX)}`],
            ['Hora cubierta', '3 de 4 intervalos'],
            ['Puntos mínimos para la tendencia de suciedad', String(SOILING_MIN_POINTS)],
            ['Caída mínima para predecir lavado / máximo', '0.05 %/día / 120 días'],
            ['Caída parcial', '20 % dos días, índice de vecinas < 0.8'],
            ['Recuperación de caída / de suciedad', '< 10 % / < 5 %'],
            ['"Lavar pronto"', '1 a 7 días'],
            [
              'Alto impacto (pregunta abierta: ¿configurable?)',
              `Comercial, industrial o ≥ ${LARGE_PLANT_KWP} kWp`,
            ],
            ['Margen de la ventana de sol', '30 min'],
            ['Frecuencia de lectura', '15 min; Enphase 2 h'],
            ['Conservación de lecturas de 15 min', `${TELEMETRY_RETENTION_MONTHS} meses`],
            ['Cálculo nocturno / resumen diario', '22:00 / 07:00'],
          ]}
        />
      </Section>

      <Section id="calendario" number={6} title="Calendario de tareas automáticas">
        <P muted>Las horas son de la zona horaria de cada empresa.</P>
        <Table
          head={['Tarea', 'Cuándo']}
          rows={[
            ['Lectura de inversores', 'Cada 15 min con sol (Enphase cada 2 h)'],
            ['Clima', 'Cada hora'],
            ['Alerta "sin datos"', 'Cada hora'],
            ['Cálculo diario y alertas', '22:00'],
            ['Resumen diario por correo', '07:00'],
            ['Reportes mensuales', 'Día 1 a las 08:00 (mes anterior)'],
            ['Limpieza de lecturas viejas', 'Día 2 de cada mes, de madrugada'],
          ]}
        />
        <P muted>La última ejecución de cada tarea se ve en Salud del sistema.</P>
      </Section>

      <Section id="estandares" number={7} title="Estándares y referencias">
        <P>
          Una parte de los cálculos sigue normas reconocidas de la industria y otra parte es propia
          de PV-IoT. Esta sección las separa para explicarlo a clientes y técnicos.
        </P>

        <H3>7.1 Lo que sigue un estándar</H3>
        <Table
          head={['Cálculo', 'Referencia', 'Nota']}
          rows={[
            [
              'PR (índice de rendimiento) y rendimiento específico (kWh/kWp)',
              'Norma internacional IEC 61724-1 (monitoreo del desempeño de plantas fotovoltaicas)',
              'Mismas fórmulas que usa la industria',
            ],
            [
              'Temperatura de celda con el NOCT y factor por calor con γ',
              'Modelo clásico de las hojas de datos de los paneles',
              'NOCT y γ vienen de la hoja del panel de cada planta',
            ],
            [
              'PR corregido por temperatura',
              'Práctica reconocida; la más conocida es el "PR corregido por clima" de NREL (laboratorio de energía renovable de EE. UU.)',
              'NREL corrige contra la temperatura promedio del año y PV-IoT contra 25 °C. Por eso el nuestro sale un poco más alto. No afecta las alertas: cada planta se compara contra sí misma',
            ],
            [
              'Disponibilidad',
              'Misma idea que la IEC 61724-1',
              'Horas con sol con datos ÷ horas con sol',
            ],
          ]}
        />

        <H3>7.2 Lo que es propio de PV-IoT</H3>
        <Table
          head={['Cálculo', 'Por qué es propio']}
          rows={[
            [
              'Línea base, desviación y comparación con vecinas',
              `Decisiones de diseño (percentil 80 de ${BASELINE_WINDOW_DAYS} días, radio de ${n(T.neighbor_radius_km)} km). Ninguna norma las dicta`,
            ],
            [
              'Suciedad y fecha de lavado',
              'La IEC define cómo medir la pérdida por suciedad, pero con un sensor en sitio. La recta de tendencia de PV-IoT es un método propio y más simple. Hay métodos publicados más elaborados, como uno de NREL que también usa las lluvias y los lavados',
            ],
            [
              'Reglas de alertas',
              'Umbrales, días seguidos, evento de zona y prioridad. Cada plataforma tiene las suyas; no hay un estándar',
            ],
          ]}
        />

        <H3>7.3 Por qué los números no coinciden con los portales de los fabricantes</H3>
        <List
          ordered
          items={[
            <>
              <strong>La irradiancia.</strong> Las plantas grandes miden el sol con un sensor en
              sitio. PV-IoT lo estima con datos satelitales y modelos (Open-Meteo), sin instalar
              equipo. Es lo normal en plantas residenciales y comerciales, pero tiene más error día
              a día: típicamente algunos puntos porcentuales, y más en días nublados cambiantes.
            </>,
            <>
              <strong>Los portales de Victron, GoodWe, Growatt o Enphase</strong> casi siempre
              muestran solo energía y potencia. Si muestran un PR, suele ser sin corrección por
              temperatura, y cada uno lo calcula a su manera.
            </>,
            <>
              <strong>La energía sí debe coincidir</strong>, porque viene del mismo inversor. Está
              pendiente una validación diaria contra el total del fabricante.
            </>,
          ]}
        />

        <H3>7.4 Cómo explicarlo a un cliente</H3>
        <List
          items={[
            <>
              <strong>En una frase:</strong> "Usamos las fórmulas de la norma IEC 61724-1, con
              irradiancia estimada por satélite".
            </>,
            'El PR es una señal para detectar cambios en cada planta, no una medición de laboratorio. Por eso las alertas comparan cada planta contra su propio historial y contra sus vecinas, y no contra un valor fijo.',
            'Si un cliente grande pide precisión de norma, la mejora es instalar un sensor de irradiancia en su planta (todavía no disponible en la plataforma).',
          ]}
        />
      </Section>

      <Section id="pendientes" number={8} title="Preguntas abiertas que afectan los cálculos">
        <List
          items={[
            `Factor de CO₂ vigente para México (hoy ${n(D.co2_kg_per_kwh, 3)} kg/kWh).`,
            `Umbral de alto impacto de ${LARGE_PLANT_KWP} kWp: ¿se ajusta o se hace configurable por empresa?`,
            'Plantas con batería: ¿se quiere un aviso suave de bajo rendimiento?',
            'Etapa 2: varios inversores por planta y tarifas de negocio de CFE.',
          ]}
        />
      </Section>
    </div>
  );
}

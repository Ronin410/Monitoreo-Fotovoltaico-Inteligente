import type { PillarArt } from './content';

// Ilustraciones del sitio público. Son esquemas con datos de ejemplo, no pantallas reales: cada
// una lo dice en su texto alternativo.

/** Leyenda visible: los números de las ilustraciones no son de clientes reales. */
function Example() {
  return (
    <figcaption className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
      Ilustración con datos de ejemplo
    </figcaption>
  );
}

const frame =
  'w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-25px_rgba(8,47,73,0.35)] dark:border-slate-800 dark:bg-slate-900';

/** Curva de producción del día: esperada (punteada) contra real. */
function Performance() {
  // Campana del día solar de 6:00 a 19:00, en un lienzo de 300 × 140.
  const curve = (scale: number) =>
    Array.from({ length: 27 }, (_, i) => {
      const x = 10 + i * 10.8;
      const y = 120 - scale * 100 * Math.sin((Math.PI * i) / 26) ** 1.4;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  return (
    <figure
      className={frame}
      aria-label="Ejemplo: producción esperada contra producción real de un día"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-800 dark:text-slate-100">Producción de hoy</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Rinde 96 % de lo esperado
        </span>
      </div>
      <svg viewBox="0 0 300 140" className="mt-4 w-full" aria-hidden="true">
        {[40, 80, 120].map((y) => (
          <line
            key={y}
            x1="10"
            x2="290"
            y1={y}
            y2={y}
            className="stroke-slate-100 dark:stroke-slate-800"
          />
        ))}
        <path d={`${curve(0.96)} L290.8,120 L10,120 Z`} className="fill-amber-400/20" />
        <path
          d={curve(1)}
          fill="none"
          strokeWidth="2"
          strokeDasharray="5 5"
          className="stroke-slate-400"
        />
        <path d={curve(0.96)} fill="none" strokeWidth="2.5" className="stroke-amber-500" />
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-600 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-amber-500" /> Real
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-slate-400" /> Esperada por el
          clima
        </span>
      </div>
      <Example />
    </figure>
  );
}

/** Tendencia de suciedad: el rendimiento baja día con día hasta la fecha de lavado. */
function Soiling() {
  const days = Array.from({ length: 14 }, (_, i) => ({
    x: 22 + i * 18,
    y: 30 + i * 4.6 + (i % 3) * 2,
  }));
  return (
    <figure
      className={frame}
      aria-label="Ejemplo: rendimiento que baja por suciedad y fecha sugerida de lavado"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          Tendencia de suciedad
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Lavar en 4 días
        </span>
      </div>
      <svg viewBox="0 0 300 140" className="mt-4 w-full" aria-hidden="true">
        <line
          x1="10"
          x2="290"
          y1="110"
          y2="110"
          strokeDasharray="4 4"
          className="stroke-red-300 dark:stroke-red-800"
        />
        <text x="12" y="126" className="fill-red-500 text-[9px]">
          Umbral para lavar
        </text>
        <line
          x1="22"
          y1="30"
          x2="276"
          y2="106"
          strokeWidth="2"
          className="stroke-cyan-700 dark:stroke-cyan-400"
        />
        {days.map((d) => (
          <circle key={d.x} cx={d.x} cy={d.y} r="3.5" className="fill-amber-500" />
        ))}
        <rect x="262" y="18" width="30" height="96" rx="6" className="fill-cyan-600/10" />
      </svg>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        Cada punto es un día válido; la línea es la tendencia.
      </p>
      <Example />
    </figure>
  );
}

/** Alerta con evidencia y su ticket. */
function Alerts() {
  return (
    <figure
      className={frame}
      aria-label="Ejemplo: alerta de caída brusca con su explicación y su ticket"
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 size-2.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Caída brusca · Bodega Norte
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Produce 38 % menos que su normal desde ayer
          </p>
        </div>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        El día fue soleado y las plantas vecinas rindieron normal, así que no es el clima. Una caída
        de este tamaño suele indicar una falla en una de las cadenas de paneles o en el inversor.
      </p>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
        <span className="text-slate-700 dark:text-slate-300">Ticket · Revisión en sitio</span>
        <span className="rounded-full bg-cyan-100 px-2 py-0.5 font-medium text-cyan-900 dark:bg-cyan-950 dark:text-cyan-300">
          En curso
        </span>
      </div>
      <Example />
    </figure>
  );
}

/** Reporte mensual del cliente. */
function Report() {
  const bars = [62, 70, 58, 75, 80, 72, 85, 78, 90, 84, 76, 88];
  return (
    <figure
      className={frame}
      aria-label="Ejemplo: reporte mensual en PDF con la marca de la instaladora"
    >
      <div className="flex items-center gap-2">
        <span className="size-6 rounded-md bg-cyan-700" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
          Su empresa · Reporte de octubre
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <p className="text-slate-600 dark:text-slate-400">Energía del mes</p>
          <p className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
            812 kWh
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <p className="text-slate-600 dark:text-slate-400">Ahorro estimado</p>
          <p className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
            $1,705
          </p>
        </div>
      </div>
      <svg viewBox="0 0 240 70" className="mt-4 w-full" aria-hidden="true">
        {bars.map((h, i) => (
          <rect
            key={i}
            x={4 + i * 19.5}
            y={70 - h * 0.7}
            width="13"
            height={h * 0.7}
            rx="3"
            className="fill-amber-400"
          />
        ))}
      </svg>
      <Example />
    </figure>
  );
}

export function PillarIllustration({ art }: { art: PillarArt }) {
  if (art === 'performance') return <Performance />;
  if (art === 'soiling') return <Soiling />;
  if (art === 'alerts') return <Alerts />;
  return <Report />;
}

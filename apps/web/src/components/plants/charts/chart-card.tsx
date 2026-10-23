import type { ReactNode } from 'react';

/** Tarjeta de gráfica: título, controles y una tabla con los mismos datos (accesibilidad). */
export function ChartCard({
  title,
  description,
  controls,
  table,
  children,
}: {
  title: string;
  description?: ReactNode;
  controls?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
          )}
        </div>
        {controls}
      </div>
      {children}
      {table && (
        <details className="text-sm">
          <summary className="cursor-pointer py-1 text-brand-text">Ver los datos en tabla</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            {table}
          </div>
        </details>
      )}
    </section>
  );
}

/** Leyenda en HTML (texto en color de texto; el trazo lleva la identidad). */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <svg aria-hidden="true" width="20" height="8">
            <line
              x1="0"
              y1="4"
              x2="20"
              y2="4"
              stroke={i.color}
              strokeWidth="2"
              strokeDasharray={i.dashed ? '4 3' : undefined}
            />
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export const tableClass =
  'w-full text-left text-xs [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold';

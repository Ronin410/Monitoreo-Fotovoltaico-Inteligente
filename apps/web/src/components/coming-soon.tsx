import { Construction } from 'lucide-react';

/** Sección del menú que aún no se construye: dice en qué tarea del plan llega. */
export function ComingSoon({
  title,
  task,
  description,
}: {
  title: string;
  task: string;
  description: string;
}) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex gap-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <Construction aria-hidden="true" className="size-6 shrink-0 text-slate-500" />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">En construcción ({task})</p>
          <p className="text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </section>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const btn =
    'flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-40 dark:border-slate-600';
  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-3 text-sm">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden="true" className="size-4" /> Anterior
      </button>
      <span className="text-slate-600 dark:text-slate-400">
        Página {page} de {pages} · {total} en total
      </span>
      <button
        type="button"
        className={btn}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Siguiente <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

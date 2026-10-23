'use client';

import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LinkButton, PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Notice, Spinner } from '@/components/ui';
import { clientsResponse } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';

const PAGE_SIZE = 25;

export function ClientsList() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Busca al dejar de escribir.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (query) params.set('q', query);
  const { data, error, loading } = useApiQuery(`/clients?${params}`, clientsResponse);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Clientes"
        subtitle={data ? `${data.total} clientes` : undefined}
        actions={
          <LinkButton href="/clients/new">
            <Plus aria-hidden="true" className="size-4" /> Nuevo cliente
          </LinkButton>
        }
      />
      <div className="relative max-w-md">
        <label htmlFor="buscar" className="sr-only">
          Buscar cliente
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        />
        <input
          id="buscar"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o contacto"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-base dark:border-slate-600 dark:bg-slate-900"
        />
      </div>
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">
          {query
            ? 'Ningún cliente coincide con la búsqueda.'
            : 'Aún no hay clientes. Crea el primero para dar de alta sus plantas.'}
        </Notice>
      ) : data ? (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex h-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                >
                  <span className="font-semibold">{c.name}</span>
                  {c.contact_name && (
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {c.contact_name}
                    </span>
                  )}
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {c.colonia} · CP {c.postal_code}
                  </span>
                  <span className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                    {c.plant_count === 1 ? '1 planta' : `${c.plant_count} plantas`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

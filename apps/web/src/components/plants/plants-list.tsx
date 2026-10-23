'use client';

import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Filter, filterControl } from '@/components/filter';
import { LinkButton, PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { STATUS } from '@/components/status';
import { Notice, Spinner } from '@/components/ui';
import type { PlantStatus } from '@/lib/dashboard';
import {
  BRAND_LABELS,
  INVERTER_BRAND_OPTIONS,
  LIFECYCLE_LABELS,
  plantsResponse,
} from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';
import { PlantTable } from './plant-table';

const PAGE_SIZE = 25;
const SORTS = [
  { value: 'name', label: 'Nombre' },
  { value: '-pr_7d', label: 'Mejor PR (7 días)' },
  { value: 'pr_7d', label: 'Peor PR (7 días)' },
  { value: '-deviation', label: 'Mayor desviación' },
  { value: 'days_to_cleaning', label: 'Lavado más próximo' },
  { value: '-capacity_kwp', label: 'Mayor capacidad' },
];

export function PlantsList() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [health, setHealth] = useState('');
  const [status, setStatus] = useState('active');
  const [brand, setBrand] = useState('');
  const [colonia, setColonia] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), sort });
  if (query) params.set('q', query);
  if (health) params.set('health', health);
  if (status) params.set('status', status);
  if (brand) params.set('brand', brand);
  if (colonia.trim()) params.set('colonia', colonia.trim());
  if (/^\d{5}$/.test(postalCode)) params.set('postal_code', postalCode);
  const { data, error, loading } = useApiQuery(`/plants?${params}`, plantsResponse);
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Plantas"
        subtitle={data ? `${data.total} plantas` : undefined}
        actions={
          <LinkButton href="/plants/new">
            <Plus aria-hidden="true" className="size-4" /> Nueva planta
          </LinkButton>
        }
      />
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <label htmlFor="buscar" className="sr-only">
            Buscar planta o cliente
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
            placeholder="Buscar por planta o cliente"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-base dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Filter
            id="health"
            label="Estado"
            value={health}
            onChange={reset(setHealth)}
            options={[
              { value: '', label: 'Todos' },
              ...(Object.keys(STATUS) as PlantStatus[]).map((s) => ({
                value: s,
                label: STATUS[s].label,
              })),
            ]}
          />
          <Filter
            id="lifecycle"
            label="Monitoreo"
            value={status}
            onChange={reset(setStatus)}
            options={[
              { value: '', label: 'Todas' },
              ...Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Filter
            id="brand"
            label="Marca"
            value={brand}
            onChange={reset(setBrand)}
            options={[
              { value: '', label: 'Todas' },
              ...INVERTER_BRAND_OPTIONS.map((b) => ({ value: b, label: BRAND_LABELS[b] })),
            ]}
          />
          <label
            htmlFor="colonia"
            className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Colonia
            <input
              id="colonia"
              value={colonia}
              onChange={(e) => reset(setColonia)(e.target.value)}
              className={filterControl}
            />
          </label>
          <label
            htmlFor="cp"
            className="flex min-w-28 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400"
          >
            Código postal
            <input
              id="cp"
              inputMode="numeric"
              maxLength={5}
              value={postalCode}
              onChange={(e) => reset(setPostalCode)(e.target.value)}
              className={filterControl}
            />
          </label>
          <Filter
            id="sort"
            label="Ordenar por"
            value={sort}
            onChange={reset(setSort)}
            options={SORTS}
          />
        </div>
      </div>
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">Ninguna planta coincide con los filtros.</Notice>
      ) : data ? (
        <>
          <PlantTable plants={data.data} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

'use client';

import { can } from '@pv/core';
import { CalendarDays, MapPin, Phone, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Filter } from '@/components/filter';
import { LinkButton, PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import {
  assigneesResponse,
  mapsUrl,
  PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
  ticketsPage,
  type Ticket,
  type TicketStatus,
} from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';
import { TicketActions } from './ticket-actions';

// Tickets (specs/09 §Tickets): el operador ve lista o tablero por estado; el técnico, en el
// celular, tarjetas grandes con sus tickets abiertos.

const PAGE_SIZE = 25;
const BOARD: TicketStatus[] = ['pending', 'scheduled', 'in_progress'];

export function PriorityBadge({ priority }: { priority: Ticket['priority'] }) {
  if (priority === 'normal') return null;
  const style =
    priority === 'high'
      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${style}`}>
      Prioridad {PRIORITY_LABELS[priority].toLowerCase()}
    </span>
  );
}

function when(t: Ticket) {
  return t.scheduled_for
    ? formatDate(t.scheduled_for, { weekday: 'short', day: 'numeric', month: 'short' })
    : null;
}

/** Tarjeta grande del técnico: dónde, qué revisar y los botones de estado. */
function FieldCard({ ticket, onChange }: { ticket: Ticket; onChange: () => void }) {
  const c = ticket.plant.client;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/tickets/${ticket.id}`}
            className="text-lg font-semibold break-words text-brand-text hover:underline"
          >
            {ticket.title}
          </Link>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {TICKET_TYPE_LABELS[ticket.type]} · {TICKET_STATUS_LABELS[ticket.status]}
          </span>
        </div>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <div className="flex flex-col gap-1 text-base">
        <span className="font-medium">
          {c.name} · {ticket.plant.name}
        </span>
        <a
          href={mapsUrl(
            ticket.plant.lat,
            ticket.plant.lon,
            `${c.address}, ${ticket.plant.colonia}`,
          )}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-2 text-brand-text hover:underline"
        >
          <MapPin aria-hidden="true" className="size-5 shrink-0" />
          <span>
            {c.address}, {ticket.plant.colonia}
            <span className="sr-only"> (abrir en Google Maps)</span>
          </span>
        </a>
        {c.phone && (
          <a
            href={`tel:${c.phone.replace(/\s/g, '')}`}
            className="flex min-h-11 items-center gap-2 text-brand-text hover:underline"
          >
            <Phone aria-hidden="true" className="size-5 shrink-0" />
            {c.contact_name ? `${c.contact_name} · ` : ''}
            {c.phone}
          </a>
        )}
        {when(ticket) && (
          <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <CalendarDays aria-hidden="true" className="size-4" /> Programado: {when(ticket)}
          </span>
        )}
      </div>
      {ticket.description && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Qué revisar
          </span>
          {ticket.description}
        </div>
      )}
      <TicketActions ticket={ticket} canCancel={false} onChange={onChange} />
    </li>
  );
}

function TechnicianTickets() {
  const [show, setShow] = useState<'open' | 'closed'>('open');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApiQuery(
    `/tickets?open=${show === 'open'}&page=${page}&page_size=${PAGE_SIZE}`,
    ticketsPage,
  );
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="Mis tickets"
        subtitle={
          data ? `${data.total} ${show === 'open' ? 'por atender' : 'cerrados'}` : undefined
        }
      />
      <fieldset className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
        <legend className="sr-only">Mostrar</legend>
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={show === s}
            onClick={() => {
              setShow(s);
              setPage(1);
            }}
            className={`min-h-11 flex-1 rounded-md px-3 text-sm ${show === s ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-600 dark:text-slate-400'}`}
          >
            {s === 'open' ? 'Por atender' : 'Cerrados'}
          </button>
        ))}
      </fieldset>
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">
          {show === 'open' ? 'No tienes tickets pendientes.' : 'Aún no tienes tickets cerrados.'}
        </Notice>
      ) : data ? (
        <>
          <ul className="flex flex-col gap-4">
            {data.data.map((t) => (
              <FieldCard key={t.id} ticket={t} onChange={() => void reload()} />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/tickets/${ticket.id}`}
          className="font-medium break-words text-brand-text hover:underline"
        >
          {ticket.title}
        </Link>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <span className="text-xs text-slate-600 dark:text-slate-400">
        {TICKET_TYPE_LABELS[ticket.type]} · {ticket.plant.client.name} · {ticket.plant.colonia}
      </span>
      <span className="text-xs text-slate-600 dark:text-slate-400">
        {ticket.assigned_to ? ticket.assigned_to.name : 'Sin asignar'}
        {when(ticket) ? ` · ${when(ticket)}` : ''}
      </span>
    </li>
  );
}

function ManagerTickets() {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [assignee, setAssignee] = useState('');
  const [page, setPage] = useState(1);
  const assignees = useApiQuery('/tickets/assignees', assigneesResponse);

  const params = new URLSearchParams();
  // El tablero muestra los abiertos por estado (hasta 100); la lista pagina y filtra.
  if (view === 'board') {
    params.set('open', 'true');
    params.set('page_size', '100');
  } else {
    params.set('page', String(page));
    params.set('page_size', String(PAGE_SIZE));
    if (status === 'open' || status === 'closed') params.set('open', String(status === 'open'));
    else if (status) params.set('status', status);
  }
  if (type) params.set('type', type);
  if (assignee) params.set('assigned_to', assignee);
  const { data, error, loading } = useApiQuery(`/tickets?${params}`, ticketsPage);
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Tickets"
        subtitle={data ? `${data.total} ${data.total === 1 ? 'ticket' : 'tickets'}` : undefined}
        actions={
          <LinkButton href="/tickets/new">
            <Plus aria-hidden="true" className="size-4" /> Nuevo ticket
          </LinkButton>
        }
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <fieldset className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          <legend className="sr-only">Vista</legend>
          {(['list', 'board'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-10 rounded-md px-3 text-sm ${view === v ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-600 dark:text-slate-400'}`}
            >
              {v === 'list' ? 'Lista' : 'Tablero'}
            </button>
          ))}
        </fieldset>
        {view === 'list' && (
          <Filter
            id="status"
            label="Estado"
            value={status}
            onChange={reset(setStatus)}
            options={[
              { value: 'open', label: 'Abiertos' },
              { value: 'closed', label: 'Cerrados' },
              { value: '', label: 'Todos' },
              ...Object.entries(TICKET_STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        )}
        <Filter
          id="type"
          label="Tipo"
          value={type}
          onChange={reset(setType)}
          options={[
            { value: '', label: 'Todos' },
            ...Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Filter
          id="assignee"
          label="Asignado a"
          value={assignee}
          onChange={reset(setAssignee)}
          options={[
            { value: '', label: 'Cualquiera' },
            ...(assignees.data?.data ?? []).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </div>

      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && view === 'board' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {BOARD.map((s) => {
            const column = data.data.filter((t) => t.status === s);
            return (
              <section
                key={s}
                aria-labelledby={`col-${s}`}
                className="flex flex-col gap-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-900/60"
              >
                <h2 id={`col-${s}`} className="text-sm font-semibold">
                  {TICKET_STATUS_LABELS[s]}{' '}
                  <span className="font-normal text-slate-600 dark:text-slate-400">
                    ({column.length})
                  </span>
                </h2>
                {column.length === 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-400">Ninguno.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {column.map((t) => (
                      <TicketRow key={t.id} ticket={t} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">Ningún ticket coincide con los filtros.</Notice>
      ) : data ? (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ticket
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Planta
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Asignado a
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Programado
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="font-medium text-brand-text hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {TICKET_TYPE_LABELS[t.type]}
                        <PriorityBadge priority={t.priority} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {t.plant.name}
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {t.plant.client.name} · {t.plant.colonia}
                      </div>
                    </td>
                    <td className="px-4 py-3">{t.assigned_to?.name ?? 'Sin asignar'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{when(t) ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {TICKET_STATUS_LABELS[t.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.data.map((t) => (
              <TicketRow key={t.id} ticket={t} />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

export function TicketsView() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <Spinner />;
  return can(state.user.role, 'alerts:manage') ? <ManagerTickets /> : <TechnicianTickets />;
}

'use client';

import { can } from '@pv/core';
import { MapPin, Pencil, Phone } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  fieldErrors,
  SelectInput,
  TextArea,
  TextInput,
  textOrNull,
  type FieldErrors,
} from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { TodayChart } from '@/components/plants/charts/today-chart';
import { SeverityBadge } from '@/components/status';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { ALERT_TYPE_LABELS } from '@/lib/dashboard';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import {
  mapsUrl,
  OPEN_TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
  ticketSchema,
  type Ticket,
} from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';
import { AssignmentFields, assignmentBody } from './ticket-fields';
import { PriorityBadge } from './tickets-view';
import { TicketActions } from './ticket-actions';

// Detalle de un ticket: dónde y qué hacer, cambios de estado y, para quien gestiona, edición de
// la asignación. El técnico ve también la potencia de hoy de la planta (specs/09: "el detalle de
// la planta de cada ticket").

const card =
  'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  );
}

function EditForm({
  ticket,
  onSaved,
  onCancel,
}: {
  ticket: Ticket;
  onSaved: (t: Ticket) => void;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      onSaved(
        await api(`/tickets/${ticket.id}`, ticketSchema, {
          method: 'PATCH',
          body: {
            type: f.get('type'),
            title: String(f.get('title') ?? '').trim(),
            description: textOrNull(f, 'description'),
            ...assignmentBody(f),
          },
        }),
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={card} aria-labelledby="edit-title">
      <h2 id="edit-title" className="text-base font-semibold">
        Editar ticket
      </h2>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          id="title"
          label="Título"
          required
          maxLength={200}
          defaultValue={ticket.title}
          error={errors.title}
        />
        <SelectInput
          id="type"
          label="Tipo"
          defaultValue={ticket.type}
          error={errors.type}
          options={Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <div className="sm:col-span-2">
          <TextArea
            id="description"
            label="Qué revisar"
            maxLength={4000}
            defaultValue={ticket.description ?? ''}
            error={errors.description}
          />
        </div>
        <AssignmentFields ticket={ticket} errors={errors} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function TicketDetail({ id }: { id: string }) {
  const { state } = useAuth();
  const timezone = useCompanyTimezone();
  const query = useApiQuery(`/tickets/${id}`, ticketSchema);
  const [updated, setUpdated] = useState<Ticket | null>(null);
  const [editing, setEditing] = useState(false);
  const manage = state.status === 'authenticated' && can(state.user.role, 'alerts:manage');

  if (query.error) {
    return (
      <Notice tone="error">
        {query.error.status === 404
          ? 'Este ticket no existe o no está asignado a ti.'
          : query.error.message}
      </Notice>
    );
  }
  const t = updated?.id === id ? updated : query.data;
  if (!t) return <Spinner />;
  const c = t.plant.client;
  const isOpen = OPEN_TICKET_STATUSES.includes(t.status);
  const onChange = (next: Ticket) => {
    setUpdated(next);
    setEditing(false);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={t.title}
        back={{ href: '/tickets', label: manage ? 'Tickets' : 'Mis tickets' }}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{TICKET_STATUS_LABELS[t.status]}</span>
            <span>· {TICKET_TYPE_LABELS[t.type]}</span>
            <PriorityBadge priority={t.priority} />
          </span>
        }
        actions={
          manage && isOpen && !editing ? (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" className="size-4" /> Editar
            </Button>
          ) : undefined
        }
      />

      {t.status === 'resolved' && (
        <Notice tone="success">
          Resuelto{t.resolved_at ? ` el ${formatDateTime(t.resolved_at, timezone)}` : ''}
          {t.cleaning_performed ? ' · se realizó limpieza' : ''}.
          {t.resolution_notes ? ` ${t.resolution_notes}` : ''}
        </Notice>
      )}
      {t.status === 'cancelled' && <Notice tone="info">Este ticket fue cancelado.</Notice>}

      {editing ? (
        <EditForm ticket={t} onSaved={onChange} onCancel={() => setEditing(false)} />
      ) : (
        isOpen && (
          <section className={card} aria-label="Cambiar estado">
            <TicketActions ticket={t} canCancel={manage} onChange={onChange} />
          </section>
        )
      )}

      <section className={card}>
        <h2 className="text-base font-semibold">Dónde</h2>
        <div className="flex flex-col gap-1 text-base">
          <span className="font-medium">
            {manage ? (
              <Link href={`/plants/${t.plant.id}`} className="text-brand-text hover:underline">
                {t.plant.name}
              </Link>
            ) : (
              t.plant.name
            )}{' '}
            · {formatNumber(t.plant.capacity_kwp, 1)} kWp
          </span>
          <span>{c.name}</span>
          <a
            href={mapsUrl(t.plant.lat, t.plant.lon, `${c.address}, ${t.plant.colonia}`)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-2 text-brand-text hover:underline"
          >
            <MapPin aria-hidden="true" className="size-5 shrink-0" />
            <span>
              {c.address}, {t.plant.colonia}, CP {t.plant.postal_code}
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
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Qué revisar</h2>
        <p className="text-base whitespace-pre-line">{t.description ?? 'Sin descripción.'}</p>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Item label="Asignado a">{t.assigned_to?.name ?? 'Sin asignar'}</Item>
          <Item label="Programado">
            {t.scheduled_for &&
              formatDate(t.scheduled_for, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Item>
          <Item label="Creado">
            {`${formatDateTime(t.created_at, timezone)}${t.created_by ? ` por ${t.created_by.name}` : ''}`}
          </Item>
        </dl>
        {t.alert && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600 dark:text-slate-400">Origen:</span>
            <SeverityBadge severity={t.alert.severity} />
            {manage ? (
              <Link href={`/alerts/${t.alert.id}`} className="text-brand-text hover:underline">
                {ALERT_TYPE_LABELS[t.alert.type]}
              </Link>
            ) : (
              ALERT_TYPE_LABELS[t.alert.type]
            )}
            <span className="text-slate-600 dark:text-slate-400">
              · detectada {formatDateTime(t.alert.detected_at, timezone)}
            </span>
          </div>
        )}
      </section>

      {isOpen && <TodayChart plantId={t.plant.id} />}
    </div>
  );
}

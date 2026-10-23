'use client';

import { useState, type FormEvent } from 'react';
import { SelectInput, TextArea, TextInput } from '@/components/form';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, zonedLocalToIso } from '@/lib/format';
import { eventSchema, eventsResponse, EVENT_LABELS } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';

// Eventos de la planta y registro manual (specs/09 §Detalle: registrar limpieza, reparación o
// nota). Una limpieza reinicia la tendencia de suciedad.

const SOURCE = {
  ticket: 'desde un ticket',
  auto: 'automático',
  manual: 'registrado a mano',
} as const;

export function EventsPanel({ plantId, timezone }: { plantId: string; timezone: string }) {
  const { api } = useAuth();
  const events = useApiQuery(`/plants/${plantId}/events?page_size=20`, eventsResponse);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = String(f.get('occurred_at') ?? '');
    setBusy(true);
    setError(null);
    try {
      await api(`/plants/${plantId}/events`, eventSchema, {
        method: 'POST',
        body: {
          type: f.get('type'),
          occurred_at: when ? zonedLocalToIso(when, timezone) : '',
          notes: String(f.get('notes') ?? '').trim() || null,
        },
      });
      setOpen(false);
      await events.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Eventos</h2>
        {!open && (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Registrar evento
          </Button>
        )}
      </div>
      {open && (
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              id="type"
              label="Tipo"
              options={(['cleaning', 'repair', 'inverter_replaced', 'note'] as const).map((t) => ({
                value: t,
                label: EVENT_LABELS[t],
              }))}
              hint="Una limpieza reinicia la tendencia de suciedad."
            />
            <TextInput
              id="occurred_at"
              label="Cuándo"
              type="datetime-local"
              required
              hint="Hora de la empresa."
            />
          </div>
          <TextArea id="notes" label="Notas" maxLength={2000} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar evento'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {events.error ? (
        <Notice tone="error">{events.error.message}</Notice>
      ) : !events.data ? (
        <Spinner />
      ) : events.data.data.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Sin eventos registrados.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {events.data.data.map((ev) => (
            <li key={ev.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <span className="font-medium">
                {EVENT_LABELS[ev.type]}{' '}
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  · {SOURCE[ev.source]}
                </span>
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {formatDateTime(ev.occurred_at, timezone)}
              </span>
              {ev.notes && <span className="text-slate-700 dark:text-slate-300">{ev.notes}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

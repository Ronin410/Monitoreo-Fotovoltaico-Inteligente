'use client';

import { CheckCircle2, Play } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { TextArea } from '@/components/form';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { OPEN_TICKET_STATUSES, ticketSchema, type Ticket } from '@/lib/operations';

// Cambios de estado de un ticket (specs/09 §Tickets): iniciar, resolver con notas y la casilla
// "Se realizó limpieza" (registra el evento que reinicia la tendencia de suciedad), y cancelar
// (solo quien gestiona; el técnico no puede).

export function TicketActions({
  ticket,
  canCancel,
  onChange,
}: {
  ticket: Ticket;
  canCancel: boolean;
  onChange: (ticket: Ticket) => void;
}) {
  const { api } = useAuth();
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!OPEN_TICKET_STATUSES.includes(ticket.status)) return null;
  const idPrefix = `t-${ticket.id}`;

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    try {
      onChange(await api(`/tickets/${ticket.id}`, ticketSchema, { method: 'PATCH', body }));
      setResolving(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onResolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const notes = String(f.get(`${idPrefix}-notes`) ?? '').trim();
    void patch({
      status: 'resolved',
      resolution_notes: notes === '' ? null : notes,
      cleaning_performed: f.get(`${idPrefix}-cleaning`) === 'on',
    });
  }

  if (resolving) {
    return (
      <form onSubmit={onResolve} noValidate className="flex flex-col gap-3">
        {error && <Notice tone="error">{error}</Notice>}
        <TextArea
          id={`${idPrefix}-notes`}
          label="Notas de lo que se hizo"
          maxLength={4000}
          defaultValue={ticket.resolution_notes ?? ''}
          autoFocus
        />
        <label className="flex min-h-11 items-center gap-3 text-base">
          <input
            type="checkbox"
            name={`${idPrefix}-cleaning`}
            defaultChecked={ticket.type === 'cleaning' || ticket.cleaning_performed}
            className="size-5 accent-brand"
          />
          Se realizó limpieza
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Marcar como resuelto'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setResolving(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        {ticket.status !== 'in_progress' && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void patch({ status: 'in_progress' })}
          >
            <Play aria-hidden="true" className="size-4" /> Iniciar
          </Button>
        )}
        <Button type="button" disabled={busy} onClick={() => setResolving(true)}>
          <CheckCircle2 aria-hidden="true" className="size-4" /> Resolver
        </Button>
        {canCancel && (
          <ConfirmButton
            label="Cancelar ticket"
            confirmLabel="Sí, cancelar"
            question="¿Cancelar este ticket?"
            busy={busy}
            onConfirm={() => void patch({ status: 'cancelled' })}
          />
        )}
      </div>
    </div>
  );
}

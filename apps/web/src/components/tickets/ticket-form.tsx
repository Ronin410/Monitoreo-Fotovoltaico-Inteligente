'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Fieldset,
  fieldErrors,
  SelectInput,
  TextArea,
  TextInput,
  textOrNull,
  type FieldErrors,
} from '@/components/form';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { plantsResponse } from '@/lib/inventory';
import { TICKET_TYPE_LABELS, ticketSchema } from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';
import { AssignmentFields, assignmentBody } from './ticket-fields';

// Nuevo ticket sin alerta (specs/09 §Tickets): planta, tipo, título, qué revisar y asignación.
// `?plant_id=` lo abre con la planta elegida (desde el detalle de la planta).

export function TicketForm() {
  const { api } = useAuth();
  const router = useRouter();
  const presetPlant = useSearchParams().get('plant_id') ?? '';
  const plants = useApiQuery('/plants?page_size=100&sort=name&status=active', plantsResponse);
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
      const ticket = await api('/tickets', ticketSchema, {
        method: 'POST',
        body: {
          plant_id: String(f.get('plant_id') ?? ''),
          type: f.get('type'),
          title: String(f.get('title') ?? '').trim(),
          description: textOrNull(f, 'description'),
          ...assignmentBody(f),
        },
      });
      router.push(`/tickets/${ticket.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (plants.error) return <Notice tone="error">{plants.error.message}</Notice>;
  if (!plants.data) return <Spinner />;
  if (plants.data.data.length === 0) {
    return <Notice tone="info">Primero da de alta una planta activa.</Notice>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      <Fieldset legend="Trabajo">
        <SelectInput
          id="plant_id"
          label="Planta"
          required
          defaultValue={presetPlant}
          error={errors.plant_id}
          options={[
            { value: '', label: 'Elige una planta' },
            ...plants.data.data.map((p) => ({
              value: p.id,
              label: `${p.name} · ${p.client.name}`,
            })),
          ]}
          hint={
            plants.data.total > plants.data.data.length
              ? 'Se muestran las primeras 100 plantas; desde el detalle de una planta puedes crear su ticket.'
              : undefined
          }
        />
        <SelectInput
          id="type"
          label="Tipo"
          required
          error={errors.type}
          options={Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <TextInput
          id="title"
          label="Título"
          required
          maxLength={200}
          error={errors.title}
          placeholder="Lavado de paneles"
        />
        <TextArea
          id="description"
          label="Qué revisar"
          maxLength={4000}
          error={errors.description}
          hint="Lo que verá el técnico en su celular."
        />
      </Fieldset>
      <Fieldset legend="Asignación">
        <AssignmentFields errors={errors} />
      </Fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear ticket'}
        </Button>
      </div>
    </form>
  );
}

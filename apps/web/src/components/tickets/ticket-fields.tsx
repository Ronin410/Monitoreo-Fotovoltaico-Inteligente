'use client';

import { SelectInput, TextInput } from '@/components/form';
import { assigneesResponse, PRIORITY_LABELS, type Ticket } from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';

// Campos comunes de asignación de un ticket (specs/09 §Tickets: prioridad, técnico, fecha).

const ROLE = { technician: 'técnico', operator: 'operador', company_admin: 'administrador' };

export function AssignmentFields({
  ticket,
  errors = {},
  priorityDefault = 'normal',
}: {
  ticket?: Pick<Ticket, 'priority' | 'assigned_to' | 'scheduled_for'>;
  errors?: Record<string, string>;
  priorityDefault?: Ticket['priority'];
}) {
  const assignees = useApiQuery('/tickets/assignees', assigneesResponse);
  const people = assignees.data?.data ?? [];
  // Mientras carga la lista, el asignado actual sigue siendo una opción.
  const current =
    ticket?.assigned_to && !people.some((p) => p.id === ticket.assigned_to?.id)
      ? [{ value: ticket.assigned_to.id, label: ticket.assigned_to.name }]
      : [];
  return (
    <>
      <SelectInput
        id="assigned_to"
        label="Técnico asignado"
        key={people.length}
        defaultValue={ticket?.assigned_to?.id ?? ''}
        error={errors.assigned_to}
        hint={assignees.error ? assignees.error.message : 'Recibe un correo al asignarlo.'}
        options={[
          { value: '', label: 'Sin asignar' },
          ...current,
          ...people.map((p) => ({ value: p.id, label: `${p.name} (${ROLE[p.role]})` })),
        ]}
      />
      <TextInput
        id="scheduled_for"
        label="Fecha programada"
        type="date"
        defaultValue={ticket?.scheduled_for ?? ''}
        error={errors.scheduled_for}
      />
      <SelectInput
        id="priority"
        label="Prioridad"
        defaultValue={ticket?.priority ?? priorityDefault}
        error={errors.priority}
        options={(['high', 'normal', 'low'] as const).map((p) => ({
          value: p,
          label: PRIORITY_LABELS[p],
        }))}
      />
    </>
  );
}

/** Lee los campos de asignación de un formulario (vacío → null). */
export function assignmentBody(form: FormData) {
  const assigned = String(form.get('assigned_to') ?? '');
  const date = String(form.get('scheduled_for') ?? '');
  return {
    assigned_to: assigned === '' ? null : assigned,
    scheduled_for: date === '' ? null : date,
    priority: String(form.get('priority') ?? 'normal'),
  };
}

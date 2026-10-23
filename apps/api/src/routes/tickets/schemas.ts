import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';

// Tickets de mantenimiento (specs/03 §maintenance_tickets, specs/06 §5, specs/10).

export const ticketTypeSchema = z.enum(['cleaning', 'inspection', 'repair', 'other']);
export const ticketStatusSchema = z.enum([
  'pending',
  'scheduled',
  'in_progress',
  'resolved',
  'cancelled',
]);
export const ticketPrioritySchema = z.enum(['low', 'normal', 'high']);

const text = (max: number) => z.string().trim().min(1).max(max);
const localDate = z.iso.date({ error: 'Fecha YYYY-MM-DD' });

// Entrada
export const createTicketBody = z.object({
  plant_id: z.uuid({ error: 'plant_id inválido' }),
  type: ticketTypeSchema,
  priority: ticketPrioritySchema.optional(),
  title: text(200),
  description: text(4000).nullable().optional(),
  assigned_to: z.uuid().nullable().optional(),
  scheduled_for: localDate.nullable().optional(),
});

/** Crear ticket desde una alerta: todo es opcional, se prellena con la alerta. */
export const ticketFromAlertBody = z.object({
  priority: ticketPrioritySchema.optional(),
  title: text(200).optional(),
  description: text(4000).nullable().optional(),
  assigned_to: z.uuid().nullable().optional(),
  scheduled_for: localDate.nullable().optional(),
});

/** Campos que el técnico asignado puede cambiar. */
export const TECHNICIAN_FIELDS = ['status', 'resolution_notes', 'cleaning_performed'] as const;

export const patchTicketBody = z
  .object({
    status: ticketStatusSchema,
    resolution_notes: text(4000).nullable(),
    cleaning_performed: z.boolean(),
    priority: ticketPrioritySchema,
    title: text(200),
    description: text(4000).nullable(),
    type: ticketTypeSchema,
    assigned_to: z.uuid().nullable(),
    scheduled_for: localDate.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: 'Indica al menos un campo' });

export const ticketsQuery = paginationQuery.extend({
  status: ticketStatusSchema.optional(),
  /** Abiertos: pendientes, programados y en curso. */
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  plant_id: z.uuid().optional(),
  assigned_to: z.uuid().optional(),
  type: ticketTypeSchema.optional(),
});

// Salida
const userRef = z.object({ id: z.uuid(), name: z.string() }).nullable();

/** Lo que necesita el técnico en campo: dónde está, de quién es y a quién llamar. */
const ticketPlant = z.object({
  id: z.uuid(),
  name: z.string(),
  capacity_kwp: z.number(),
  colonia: z.string(),
  postal_code: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  client: z.object({
    id: z.uuid(),
    name: z.string(),
    contact_name: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string(),
  }),
});

const ticketAlert = z
  .object({
    id: z.uuid(),
    type: z.enum(['offline', 'sudden_drop', 'soiling', 'cleaning_due_soon']),
    severity: z.enum(['info', 'warning', 'critical']),
    status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
    detected_at: z.date(),
  })
  .nullable();

export const ticketResponse = z.object({
  id: z.uuid(),
  type: ticketTypeSchema,
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  title: z.string(),
  description: z.string().nullable(),
  scheduled_for: z.string().nullable(),
  resolved_at: z.date().nullable(),
  resolution_notes: z.string().nullable(),
  cleaning_performed: z.boolean(),
  assigned_to: userRef,
  created_by: userRef,
  plant: ticketPlant,
  alert: ticketAlert,
  created_at: z.date(),
  updated_at: z.date(),
});

export const ticketsResponse = paginatedSchema(ticketResponse);

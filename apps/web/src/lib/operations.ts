import { z } from 'zod';
import { alertSeveritySchema, alertTypeSchema } from './dashboard';

// Alertas y tickets (espejo de apps/api/src/routes/{alerts,tickets}/schemas.ts).

const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), page: z.number(), page_size: z.number(), total: z.number() });

export const alertStatusSchema = z.enum(['open', 'acknowledged', 'resolved', 'dismissed']);
const alertPlant = z.object({
  id: z.uuid(),
  name: z.string(),
  colonia: z.string(),
  postal_code: z.string(),
  client_name: z.string(),
});

export const alertSummary = z.object({
  id: z.uuid(),
  type: alertTypeSchema,
  severity: alertSeveritySchema,
  status: alertStatusSchema,
  detected_at: z.string(),
  resolved_at: z.string().nullable(),
  resolution: z.enum(['auto', 'ticket', 'manual']).nullable(),
  ai_status: z.enum(['pending', 'done', 'failed', 'skipped']),
  ticket_id: z.uuid().nullable(),
  plant: alertPlant,
});
export type AlertSummary = z.infer<typeof alertSummary>;
export const alertsPage = page(alertSummary);

const evidenceDay = z.object({
  date: z.string(),
  pr_temp: z.number().nullable(),
  deviation_pct: z.number().nullable(),
  neighbor_index: z.number().nullable(),
  rain_mm: z.number().nullable(),
  valid: z.boolean(),
  zone_event: z.boolean().optional(),
});

/** Evidencia de specs/06 §3; campos opcionales porque offline trae otra forma. */
export const evidenceSchema = z
  .object({
    rule: z.string(),
    trigger: z
      .object({ dates: z.array(z.string()), deviation_pct: z.array(z.number().nullable()) })
      .optional(),
    baseline: z.object({ value: z.number().nullable(), source: z.string().nullable() }).optional(),
    trend: z
      .object({
        slope_pct_per_day: z.number().nullable(),
        confidence: z.enum(['low', 'medium', 'high']).nullable().optional(),
        days_to_cleaning: z.number().nullable().optional(),
        days_since_reset: z.number().nullable(),
        last_reset: z.object({ type: z.string(), date: z.string() }).nullable(),
      })
      .optional(),
    neighbors: z
      .object({ count: z.number().nullable(), neighbor_index: z.number().nullable() })
      .optional(),
    weather: z
      .object({
        rain_mm_14d: z.number(),
        cloud_cover_avg_pct_3d: z.number().nullable(),
        temp_amb_max_c_3d: z.number().nullable(),
      })
      .optional(),
    last_14_days: z.array(evidenceDay).optional(),
    cleaning_did_not_recover: z.boolean().optional(),
    last_reading_at: z.string().nullable().optional(),
    sun_hours_without_data: z.number().optional(),
  })
  .passthrough();

export type Evidence = z.infer<typeof evidenceSchema>;

/** Explicación IA (specs/07 §3); se valida al mostrarla, lo que no cumpla no se muestra. */
export const aiExplanationSchema = z.object({
  resumen: z.string(),
  causa_probable: z.string(),
  otras_causas: z.array(z.string()).default([]),
  confianza: z.enum(['baja', 'media', 'alta']),
  que_revisar: z.array(z.string()).default([]),
  urgencia: z.enum(['baja', 'media', 'alta']).optional(),
});
export type AiExplanation = z.infer<typeof aiExplanationSchema>;

export const alertDetail = alertSummary.extend({
  dismiss_reason: z.string().nullable(),
  evidence: z.record(z.string(), z.unknown()),
  ai_explanation: z.record(z.string(), z.unknown()).nullable(),
  estimated_loss: z
    .object({ kwh_per_day: z.number(), mxn_per_day: z.number(), tariff_mxn_per_kwh: z.number() })
    .nullable(),
});
export type AlertDetail = z.infer<typeof alertDetail>;

export const ticketTypeSchema = z.enum(['cleaning', 'inspection', 'repair', 'other']);
export const ticketStatusSchema = z.enum([
  'pending',
  'scheduled',
  'in_progress',
  'resolved',
  'cancelled',
]);
export const ticketPrioritySchema = z.enum(['low', 'normal', 'high']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketSchema = z.object({
  id: z.uuid(),
  type: ticketTypeSchema,
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  title: z.string(),
  description: z.string().nullable(),
  scheduled_for: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolution_notes: z.string().nullable(),
  cleaning_performed: z.boolean(),
  assigned_to: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  created_by: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  plant: z.object({
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
  }),
  alert: z
    .object({
      id: z.uuid(),
      type: alertTypeSchema,
      severity: alertSeveritySchema,
      status: alertStatusSchema,
      detected_at: z.string(),
    })
    .nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Ticket = z.infer<typeof ticketSchema>;
export const ticketsPage = page(ticketSchema);

export const assigneesResponse = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: z.enum(['company_admin', 'operator', 'technician']),
    }),
  ),
});

export const ALERT_STATUS_LABELS: Record<z.infer<typeof alertStatusSchema>, string> = {
  open: 'Abierta',
  acknowledged: 'Vista',
  resolved: 'Resuelta',
  dismissed: 'Descartada',
};
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: 'Pendiente',
  scheduled: 'Programado',
  in_progress: 'En curso',
  resolved: 'Resuelto',
  cancelled: 'Cancelado',
};
export const TICKET_TYPE_LABELS: Record<z.infer<typeof ticketTypeSchema>, string> = {
  cleaning: 'Lavado',
  inspection: 'Inspección',
  repair: 'Reparación',
  other: 'Otro',
};
export const PRIORITY_LABELS: Record<z.infer<typeof ticketPrioritySchema>, string> = {
  high: 'Alta',
  normal: 'Normal',
  low: 'Baja',
};
export const OPEN_TICKET_STATUSES: TicketStatus[] = ['pending', 'scheduled', 'in_progress'];

export function mapsUrl(lat: number | null, lon: number | null, address: string): string {
  const q = lat !== null && lon !== null ? `${lat},${lon}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';
import { postalCodeSchema } from '../clients/schemas.js';

// Alertas (specs/06, specs/10 §Alertas y tickets).

export const alertTypeSchema = z.enum(['offline', 'sudden_drop', 'soiling', 'cleaning_due_soon']);
export const alertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const alertStatusSchema = z.enum(['open', 'acknowledged', 'resolved', 'dismissed']);

// Entrada
export const alertsQuery = paginationQuery.extend({
  status: alertStatusSchema.optional(),
  /** Abiertas: open y acknowledged. */
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  type: alertTypeSchema.optional(),
  severity: alertSeveritySchema.optional(),
  plant_id: z.uuid().optional(),
  postal_code: postalCodeSchema.optional(),
});

export const dismissAlertBody = z.object({
  reason: z
    .string({ error: 'El motivo es obligatorio' })
    .trim()
    .min(3, 'Explica brevemente por qué se descarta')
    .max(1000),
});

// Salida
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
  detected_at: z.date(),
  resolved_at: z.date().nullable(),
  resolution: z.enum(['auto', 'ticket', 'manual']).nullable(),
  ai_status: z.enum(['pending', 'done', 'failed', 'skipped']),
  ticket_id: z.uuid().nullable(),
  plant: alertPlant,
});

export const alertDetail = alertSummary.extend({
  dismiss_reason: z.string().nullable(),
  /** Métricas que la dispararon (specs/06 §3). */
  evidence: z.record(z.string(), z.unknown()),
  /** Explicación IA (specs/07 §3); null mientras no exista. */
  ai_explanation: z.record(z.string(), z.unknown()).nullable(),
});

export const alertsResponse = paginatedSchema(alertSummary);

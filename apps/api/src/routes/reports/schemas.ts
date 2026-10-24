import { PERIOD_PATTERN } from '@pv/core';
import { z } from 'zod';

// Reportes mensuales (specs/08, specs/10 §Reportes).

export const periodSchema = z.string().regex(PERIOD_PATTERN, 'El periodo debe ser AAAA-MM');

// Entrada
export const reportsQuery = z.object({ period: periodSchema.optional() });

export const generateReportsBody = z.object({
  period: periodSchema,
  /** Sin lista: todos los clientes con planta activa en el mes. */
  client_ids: z.array(z.uuid()).min(1).max(500).optional(),
});

export const sendAllBody = z.object({ period: periodSchema });

// Salida
export const reportStatusSchema = z.enum(['pending', 'generated', 'sent', 'failed']);

const reportItem = z.object({
  client: z.object({ id: z.uuid(), name: z.string(), report_email: z.string().nullable() }),
  /** Plantas del cliente que cuentan en el mes. */
  plants: z.number().int(),
  report: z
    .object({
      id: z.uuid(),
      status: reportStatusSchema,
      narrative_source: z.enum(['ai', 'template']).nullable(),
      has_pdf: z.boolean(),
      sent_to: z.string().nullable(),
      sent_at: z.date().nullable(),
      updated_at: z.date(),
      /** El último intento de envío falló. */
      send_failed: z.boolean(),
    })
    .nullable(),
});

export const reportsResponse = z.object({
  period: z.string(),
  /** Solo se generan meses ya cerrados. */
  can_generate: z.boolean(),
  auto_send: z.boolean(),
  items: z.array(reportItem),
});

export const generateReportsResponse = z.object({
  queued: z.number().int(),
  /** Ya enviados: no se regeneran (specs/08 §1). */
  skipped_sent: z.number().int(),
});

export const sendReportResponse = z.object({ queued: z.boolean() });

export const sendAllResponse = z.object({
  queued: z.number().int(),
  without_email: z.number().int(),
});

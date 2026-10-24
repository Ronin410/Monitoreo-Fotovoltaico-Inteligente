import { z } from 'zod';

// Reportes mensuales (espejo de apps/api/src/routes/reports/schemas.ts).

export const reportStatusSchema = z.enum(['pending', 'generated', 'sent', 'failed']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportItemSchema = z.object({
  client: z.object({ id: z.uuid(), name: z.string(), report_email: z.string().nullable() }),
  plants: z.number(),
  report: z
    .object({
      id: z.uuid(),
      status: reportStatusSchema,
      narrative_source: z.enum(['ai', 'template']).nullable(),
      has_pdf: z.boolean(),
      sent_to: z.string().nullable(),
      sent_at: z.string().nullable(),
      updated_at: z.string(),
      send_failed: z.boolean(),
    })
    .nullable(),
});
export type ReportItem = z.infer<typeof reportItemSchema>;

export const reportsListSchema = z.object({
  period: z.string(),
  can_generate: z.boolean(),
  auto_send: z.boolean(),
  items: z.array(reportItemSchema),
});
export type ReportsList = z.infer<typeof reportsListSchema>;

export const generateResponse = z.object({ queued: z.number(), skipped_sent: z.number() });
export const sendResponse = z.object({ queued: z.boolean() });
export const sendAllResponse = z.object({ queued: z.number(), without_email: z.number() });

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "septiembre de 2026". */
export function periodLabel(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1] ?? ''} de ${period.slice(0, 4)}`;
}

/** Los `count` meses cerrados más recientes antes de `current` (YYYY-MM), del más nuevo al más viejo. */
export function closedPeriods(current: string, count = 12): string[] {
  const [y = 0, m = 1] = current.split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 2 - i, 1)).toISOString().slice(0, 7),
  );
}

export type RowState = 'none' | 'pending' | 'generated' | 'sent' | 'failed';

export function rowState(item: ReportItem): RowState {
  return item.report?.status ?? 'none';
}

/** El reporte se puede enviar: generado y con correo de reportes. */
export const canSend = (item: ReportItem) =>
  item.report?.status === 'generated' && item.client.report_email !== null;

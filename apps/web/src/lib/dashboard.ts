import { z } from 'zod';

// Respuestas del tablero y de la bandeja de alertas (espejo de apps/api/src/routes).

export const plantStatusSchema = z.enum(['ok', 'warning', 'critical', 'offline', 'no_data']);
export type PlantStatus = z.infer<typeof plantStatusSchema>;

export const summaryResponse = z.object({
  date: z.string(),
  timezone: z.string(),
  plants: z.object({ active: z.number(), capacity_kwp: z.number(), clients: z.number() }),
  energy_today_kwh: z.number(),
  energy_month_kwh: z.number(),
  pr_temp_7d: z.number().nullable(),
  alerts_open: z.object({ critical: z.number(), warning: z.number(), info: z.number() }),
  offline_plants: z.number(),
});

export const mapResponse = z.object({
  plants: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      client_name: z.string(),
      colonia: z.string(),
      capacity_kwp: z.number(),
      lat: z.number(),
      lon: z.number(),
      status: plantStatusSchema,
      last_power_kw: z.number().nullable(),
      last_reading_at: z.string().nullable(),
    }),
  ),
});
export type MapPlant = z.infer<typeof mapResponse>['plants'][number];

export const upcomingCleaningsResponse = z.object({
  days: z.number(),
  plants: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      client_name: z.string(),
      days_to_cleaning: z.number(),
      confidence: z.enum(['low', 'medium', 'high']).nullable(),
      deviation_pct: z.number().nullable(),
      soiling_slope_pct_per_day: z.number().nullable(),
      date: z.string(),
    }),
  ),
});

const ranked = z.object({
  id: z.uuid(),
  name: z.string(),
  client_name: z.string(),
  pr_temp_avg: z.number(),
  valid_days: z.number(),
});
export const topBottomResponse = z.object({
  days: z.number(),
  min_valid_days: z.number(),
  best: z.array(ranked),
  worst: z.array(ranked),
});

export const alertTypeSchema = z.enum(['offline', 'sudden_drop', 'soiling', 'cleaning_due_soon']);
export const alertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const alertsResponse = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      type: alertTypeSchema,
      severity: alertSeveritySchema,
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
      detected_at: z.string(),
      plant: z.object({
        id: z.uuid(),
        name: z.string(),
        colonia: z.string(),
        client_name: z.string(),
      }),
    }),
  ),
  total: z.number(),
});

export const ALERT_TYPE_LABELS: Record<z.infer<typeof alertTypeSchema>, string> = {
  offline: 'Planta sin datos',
  sudden_drop: 'Caída brusca de producción',
  soiling: 'Posible suciedad',
  cleaning_due_soon: 'Lavado próximo',
};

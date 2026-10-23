import { z } from 'zod';

// Tablero de flota (specs/09 §Tablero, specs/10 §Tablero).

export const plantStatusSchema = z.enum(['ok', 'warning', 'critical', 'offline', 'no_data']);

export const upcomingCleaningsQuery = z.object({
  days: z.coerce.number().int().min(1).max(60).default(14),
});
export const topBottomQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export const summaryResponse = z.object({
  /** Día local de la empresa. */
  date: z.string(),
  timezone: z.string(),
  plants: z.object({
    active: z.number().int(),
    capacity_kwp: z.number(),
    clients: z.number().int(),
  }),
  energy_today_kwh: z.number(),
  energy_month_kwh: z.number(),
  /** Promedio de PR corregido de los días válidos de los últimos 7 días; null sin datos. */
  pr_temp_7d: z.number().nullable(),
  alerts_open: z.object({
    critical: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
  }),
  offline_plants: z.number().int(),
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
      last_reading_at: z.date().nullable(),
    }),
  ),
});

export const upcomingCleaningsResponse = z.object({
  days: z.number().int(),
  plants: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      client_name: z.string(),
      /** 0 = ya cruzó el umbral. */
      days_to_cleaning: z.number().int(),
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
  valid_days: z.number().int(),
});

export const topBottomResponse = z.object({
  days: z.number().int(),
  /** Mínimo de días válidos para entrar al ranking. */
  min_valid_days: z.number().int(),
  best: z.array(ranked),
  worst: z.array(ranked),
});

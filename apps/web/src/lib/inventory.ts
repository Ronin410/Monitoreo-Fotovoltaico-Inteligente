import { INVERTER_BRANDS, simulationProfileSchema } from '@pv/core';
import { z } from 'zod';
import { plantStatusSchema as healthSchema } from './dashboard';

// Plantas y clientes (espejo de apps/api/src/routes/{plants,clients}/schemas.ts).

export const inverterBrandSchema = z.enum(INVERTER_BRANDS);
export type InverterBrand = z.infer<typeof inverterBrandSchema>;
export const INVERTER_BRAND_OPTIONS = inverterBrandSchema.options;
export const plantLifecycleSchema = z.enum(['active', 'paused', 'decommissioned']);

export const BRAND_LABELS: Record<InverterBrand, string> = {
  goodwe: 'GoodWe',
  huawei: 'Huawei',
  fronius: 'Fronius',
  enphase: 'Enphase',
  other: 'Otra marca',
  simulator: 'Simulador (demo)',
};
export const LIFECYCLE_LABELS: Record<z.infer<typeof plantLifecycleSchema>, string> = {
  active: 'Activa',
  paused: 'Pausada',
  decommissioned: 'Dada de baja',
};

const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), page: z.number(), page_size: z.number(), total: z.number() });

export const credentialsStatus = z.object({
  has_credentials: z.boolean(),
  provider: inverterBrandSchema.nullable(),
  updated_at: z.string().nullable(),
  last_test_at: z.string().nullable(),
  last_test_ok: z.boolean().nullable(),
});

export const plantSchema = z.object({
  id: z.uuid(),
  client: z.object({ id: z.uuid(), name: z.string() }),
  name: z.string(),
  capacity_kwp: z.number(),
  tilt_deg: z.number(),
  azimuth_deg: z.number(),
  noct_c: z.number(),
  gamma_pct_per_c: z.number(),
  panel_model: z.string().nullable(),
  panel_count: z.number().nullable(),
  inverter_brand: inverterBrandSchema,
  inverter_model: z.string().nullable(),
  inverter_serial: z.string().nullable(),
  commissioning_date: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  postal_code: z.string(),
  colonia: z.string(),
  status: plantLifecycleSchema,
  last_reading_at: z.string().nullable(),
  last_power_kw: z.number().nullable(),
  simulation_profile: simulationProfileSchema.nullable(),
  credentials: credentialsStatus,
  metrics: z
    .object({
      status: healthSchema,
      energy_today_kwh: z.number(),
      pr_temp_7d: z.number().nullable(),
      deviation_pct: z.number().nullable(),
      days_to_cleaning: z.number().nullable(),
      prediction_confidence: z.enum(['low', 'medium', 'high']).nullable(),
      last_metric_date: z.string().nullable(),
    })
    .nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Plant = z.infer<typeof plantSchema>;
export const plantsResponse = page(plantSchema);

export const clientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contact_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string(),
  colonia: z.string(),
  postal_code: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lon: z.number(),
  cfe_tariff: z.string().nullable(),
  avg_monthly_kwh: z.number().nullable(),
  avg_monthly_bill_mxn: z.number().nullable(),
  tariff_mxn_per_kwh: z.number().nullable(),
  report_email: z.string().nullable(),
  plant_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Client = z.infer<typeof clientSchema>;
export const clientsResponse = page(clientSchema);

export const credentialsTestResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  tested_at: z.string(),
});

/** Valores técnicos por defecto de la empresa (GET /company → settings.defaults). */
export const companyDefaultsResponse = z.object({
  settings: z.object({
    defaults: z.object({
      noct_c: z.number(),
      gamma_pct_per_c: z.number(),
      tilt_deg: z.number(),
      azimuth_deg: z.number(),
    }),
  }),
});

export const eventSchema = z.object({
  id: z.uuid(),
  type: z.enum([
    'cleaning',
    'rain_cleaning',
    'repair',
    'inverter_replaced',
    'commissioning',
    'note',
  ]),
  occurred_at: z.string(),
  source: z.enum(['ticket', 'auto', 'manual']),
  ticket_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export const eventsResponse = page(eventSchema);

export const EVENT_LABELS: Record<z.infer<typeof eventSchema>['type'], string> = {
  cleaning: 'Limpieza',
  rain_cleaning: 'Lavado por lluvia',
  repair: 'Reparación',
  inverter_replaced: 'Cambio de inversor',
  commissioning: 'Puesta en marcha',
  note: 'Nota',
};

export const todayResponse = z.object({
  date: z.string(),
  timezone: z.string(),
  baseline_pr: z.number(),
  intervals: z.array(
    z.object({
      ts: z.string(),
      power_kw: z.number().nullable(),
      expected_kw: z.number().nullable(),
    }),
  ),
});

export const dailyMetricsResponse = z.object({
  from: z.string(),
  to: z.string(),
  soiling_deviation_pct: z.number(),
  days: z.array(
    z.object({
      date: z.string(),
      energy_kwh: z.number(),
      pr_temp: z.number().nullable(),
      pr_baseline: z.number().nullable(),
      deviation_pct: z.number().nullable(),
      neighbor_index: z.number().nullable(),
      neighbor_count: z.number(),
      rain_mm: z.number(),
      is_valid_day: z.boolean(),
      invalid_reason: z.string().nullable(),
      days_to_cleaning: z.number().nullable(),
      soiling_slope_pct_per_day: z.number().nullable(),
      status: z.string(),
    }),
  ),
  events: z.array(z.object({ type: z.string(), date: z.string(), source: z.string() })),
});
export type DailyMetrics = z.infer<typeof dailyMetricsResponse>;

import { z } from 'zod';

// companies.settings (specs/03 §companies), validado con valores por defecto. Lo que no se
// guardó explícitamente toma el valor por defecto del spec.

const num = (min: number, max: number, def: number) => z.number().min(min).max(max).default(def);
const int = (min: number, max: number, def: number) =>
  z.number().int().min(min).max(max).default(def);

export const thresholdsSchema = z.object({
  soiling_deviation_pct: num(1, 50, 12),
  soiling_consecutive_days: int(1, 14, 3),
  sudden_drop_pct: num(5, 100, 40),
  offline_hours: num(1, 48, 4),
  rain_reset_mm: num(0.1, 100, 2),
  min_valid_irradiation_kwh_m2: num(0.1, 10, 2.0),
  min_data_completeness_pct: num(1, 100, 80),
  neighbor_radius_km: num(0.5, 50, 5),
  neighbor_min_count: int(1, 20, 3),
  zone_event_pct: num(1, 100, 60),
});

export const technicalDefaultsSchema = z.object({
  noct_c: num(30, 70, 45),
  /** %/°C, negativo. */
  gamma_pct_per_c: num(-1, -0.05, -0.4),
  tilt_deg: num(0, 90, 20),
  /** 180 = sur. */
  azimuth_deg: num(0, 360, 180),
  tariff_mxn_per_kwh: z.number().positive().max(1000).default(3.5),
  // ⚠️ specs/03: el PO debe confirmar el factor de emisión vigente para México.
  co2_kg_per_kwh: num(0, 5, 0.438),
});

export const notificationSettingsSchema = z.object({
  alert_emails: z.array(z.email().max(254)).max(20).default([]),
  auto_send_client_reports: z.boolean().default(false),
});

export const companySettingsSchema = z.object({
  thresholds: thresholdsSchema.prefault({}),
  defaults: technicalDefaultsSchema.prefault({}),
  notifications: notificationSettingsSchema.prefault({}),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;
export type Thresholds = CompanySettings['thresholds'];
export type TechnicalDefaults = CompanySettings['defaults'];

/** Settings completos a partir de lo guardado en la base (puede ser parcial o `{}`). */
export function parseCompanySettings(stored: unknown): CompanySettings {
  return companySettingsSchema.parse(stored ?? {});
}

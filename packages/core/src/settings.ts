import { z } from 'zod';

// companies.settings (specs/03 §companies). En la base se guardan solo los valores que la
// empresa cambió; al leer se completan con los valores por defecto del spec. Así un valor por
// defecto nuevo aplica a quien no lo personalizó, y "Restablecer" es borrar la sección.

export const DEFAULT_SETTINGS = {
  thresholds: {
    soiling_deviation_pct: 12,
    soiling_consecutive_days: 3,
    sudden_drop_pct: 40,
    offline_hours: 4,
    rain_reset_mm: 2,
    min_valid_irradiation_kwh_m2: 2.0,
    min_data_completeness_pct: 80,
    neighbor_radius_km: 5,
    neighbor_min_count: 3,
    zone_event_pct: 60,
  },
  defaults: {
    noct_c: 45,
    gamma_pct_per_c: -0.4,
    tilt_deg: 20,
    azimuth_deg: 180,
    tariff_mxn_per_kwh: 3.5,
    // ⚠️ specs/03: el PO debe confirmar el factor de emisión vigente para México.
    co2_kg_per_kwh: 0.438,
  },
  notifications: {
    alert_emails: [] as string[],
    auto_send_client_reports: false,
  },
} as const;

const num = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const thresholdFields = {
  soiling_deviation_pct: num(1, 50),
  soiling_consecutive_days: int(1, 14),
  sudden_drop_pct: num(5, 100),
  offline_hours: num(1, 48),
  rain_reset_mm: num(0.1, 100),
  min_valid_irradiation_kwh_m2: num(0.1, 10),
  min_data_completeness_pct: num(1, 100),
  neighbor_radius_km: num(0.5, 50),
  neighbor_min_count: int(1, 20),
  zone_event_pct: num(1, 100),
};

const technicalDefaultFields = {
  noct_c: num(30, 70),
  /** %/°C, negativo. */
  gamma_pct_per_c: num(-1, -0.05),
  tilt_deg: num(0, 90),
  /** 180 = sur. */
  azimuth_deg: num(0, 360),
  tariff_mxn_per_kwh: z.number().positive().max(1000),
  co2_kg_per_kwh: num(0, 5),
};

const notificationFields = {
  alert_emails: z
    .array(
      z
        .email()
        .max(254)
        .transform((e) => e.toLowerCase()),
    )
    .max(20)
    .refine((list) => new Set(list).size === list.length, { error: 'Correos repetidos' }),
  auto_send_client_reports: z.boolean(),
};

/** Settings completos y válidos. */
export const companySettingsSchema = z.object({
  thresholds: z.object(thresholdFields),
  defaults: z.object(technicalDefaultFields),
  notifications: z.object(notificationFields),
});

/**
 * Cambio parcial de settings (PATCH /company). Estricto: un campo desconocido es un error, no
 * se ignora. `null` en una sección la restablece a los valores por defecto.
 */
export const companySettingsPatchSchema = z.strictObject({
  thresholds: z.strictObject(thresholdFields).partial().nullable().optional(),
  defaults: z.strictObject(technicalDefaultFields).partial().nullable().optional(),
  notifications: z.strictObject(notificationFields).partial().nullable().optional(),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;
export type CompanySettingsPatch = z.infer<typeof companySettingsPatchSchema>;
export type Thresholds = CompanySettings['thresholds'];
export type TechnicalDefaults = CompanySettings['defaults'];

const SECTIONS = ['thresholds', 'defaults', 'notifications'] as const;
type Section = (typeof SECTIONS)[number];
/** Lo que se guarda en la base: solo los valores personalizados de cada sección. */
export type StoredSettings = Partial<Record<Section, Record<string, unknown>>>;

function asStored(value: unknown): StoredSettings {
  const stored: StoredSettings = {};
  if (typeof value !== 'object' || value === null) return stored;
  for (const section of SECTIONS) {
    const part = (value as Record<string, unknown>)[section];
    if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
      stored[section] = part as Record<string, unknown>;
    }
  }
  return stored;
}

/** Settings completos a partir de lo guardado (puede ser parcial o `{}`). */
export function parseCompanySettings(stored: unknown): CompanySettings {
  const s = asStored(stored);
  return companySettingsSchema.parse({
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...s.thresholds },
    defaults: { ...DEFAULT_SETTINGS.defaults, ...s.defaults },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...s.notifications },
  });
}

/**
 * Aplica un cambio a lo guardado. Devuelve lo que hay que guardar y los settings completos
 * resultantes (ya validados; lanza ZodError si el resultado no es válido).
 */
export function applySettingsPatch(
  stored: unknown,
  patch: CompanySettingsPatch,
): { stored: StoredSettings; settings: CompanySettings } {
  const current = asStored(stored);
  const next: StoredSettings = {};
  for (const section of SECTIONS) {
    const change = patch[section];
    // null restablece la sección: no se copia lo guardado.
    if (change === null) continue;
    const merged = { ...current[section], ...change };
    if (Object.keys(merged).length > 0) next[section] = merged;
  }
  return { stored: next, settings: parseCompanySettings(next) };
}

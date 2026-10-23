import { companySettingsSchema, DEFAULT_SETTINGS } from '@pv/core';
import { z } from 'zod';

// Configuración de la empresa y superadmin (espejo de apps/api/src/routes/{company,admin}).

const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), page: z.number(), page_size: z.number(), total: z.number() });

export const companyRoleSchema = z.enum(['company_admin', 'operator', 'technician']);
export type CompanyRole = z.infer<typeof companyRoleSchema>;

export const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  logo_url: z.string().nullable(),
  brand_color: z.string(),
  timezone: z.string(),
  plan: z.string(),
  ai_monthly_token_budget: z.number(),
  settings: companySettingsSchema,
});
export type Company = z.infer<typeof companySchema>;
export const logoResponse = z.object({ logo_url: z.string() });

export const companyUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['superadmin', 'company_admin', 'operator', 'technician']),
  status: z.enum(['invited', 'active', 'disabled']),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
});
export type CompanyUser = z.infer<typeof companyUserSchema>;
export const companyUsersPage = page(companyUserSchema);

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: companyRoleSchema,
  expires_at: z.string(),
});
export const pendingInvitations = z.object({
  data: z.array(invitationSchema.extend({ created_at: z.string() })),
});

export const aiUsageSchema = z.object({
  period: z.string(),
  budget_tokens: z.number(),
  used_tokens: z.number(),
  by_feature: z.array(
    z.object({
      feature: z.enum(['chat', 'alert_explanation', 'report_narrative']),
      input_tokens: z.number(),
      output_tokens: z.number(),
      requests: z.number(),
    }),
  ),
  history: z.array(z.object({ period: z.string(), tokens: z.number() })),
});

export const ROLE_LABELS: Record<CompanyRole, string> = {
  company_admin: 'Administrador',
  operator: 'Operador',
  technician: 'Técnico',
};
export const ROLE_HINTS: Record<CompanyRole, string> = {
  company_admin: 'Todo, incluida la configuración y los usuarios.',
  operator: 'Plantas, clientes, alertas, tickets, reportes y asistente.',
  technician: 'Solo sus tickets, desde el celular.',
};
export const AI_FEATURE_LABELS = {
  chat: 'Asistente',
  alert_explanation: 'Explicación de alertas',
  report_narrative: 'Narrativa de reportes',
} as const;

/** Zonas horarias de México (specs/00: el piloto es Culiacán) más la actual si es otra. */
export const MEXICO_TIMEZONES = [
  { value: 'America/Mazatlan', label: 'Pacífico (Culiacán, Mazatlán, La Paz)' },
  { value: 'America/Mexico_City', label: 'Centro (CDMX, Guadalajara, Monterrey)' },
  { value: 'America/Hermosillo', label: 'Sonora (sin horario de verano)' },
  { value: 'America/Tijuana', label: 'Noroeste (Tijuana, Mexicali)' },
  { value: 'America/Cancun', label: 'Sureste (Cancún, Chetumal)' },
  { value: 'America/Chihuahua', label: 'Chihuahua' },
];

type FieldMeta = { key: string; label: string; unit?: string; hint: string; step: number };

/** Umbrales de specs/06 con su explicación en lenguaje de operador. */
export const THRESHOLD_FIELDS: FieldMeta[] = [
  {
    key: 'soiling_deviation_pct',
    label: 'Desviación para suciedad',
    unit: '%',
    hint: 'Qué tan por debajo de su normal debe rendir una planta para sospechar suciedad.',
    step: 0.5,
  },
  {
    key: 'soiling_consecutive_days',
    label: 'Días seguidos con suciedad',
    unit: 'días',
    hint: 'Días válidos seguidos por debajo del umbral antes de abrir la alerta.',
    step: 1,
  },
  {
    key: 'sudden_drop_pct',
    label: 'Caída brusca',
    unit: '%',
    hint: 'Caída de un día a otro que se trata como falla (inversor, string), no como polvo.',
    step: 1,
  },
  {
    key: 'offline_hours',
    label: 'Horas de sol sin datos',
    unit: 'h',
    hint: 'Horas con sol sin lecturas para marcar una planta como sin datos.',
    step: 0.5,
  },
  {
    key: 'rain_reset_mm',
    label: 'Lluvia que lava',
    unit: 'mm',
    hint: 'Lluvia del día que se considera un lavado natural de los paneles.',
    step: 0.1,
  },
  {
    key: 'min_valid_irradiation_kwh_m2',
    label: 'Irradiación mínima de un día válido',
    unit: 'kWh/m²',
    hint: 'Los días más nublados no cuentan para medir el rendimiento.',
    step: 0.1,
  },
  {
    key: 'min_data_completeness_pct',
    label: 'Datos mínimos de un día válido',
    unit: '%',
    hint: 'Porcentaje de lecturas del día necesario para usarlo.',
    step: 1,
  },
  {
    key: 'neighbor_radius_km',
    label: 'Radio de vecinas',
    unit: 'km',
    hint: 'Distancia para comparar una planta con las de su zona.',
    step: 0.5,
  },
  {
    key: 'neighbor_min_count',
    label: 'Vecinas mínimas',
    unit: 'plantas',
    hint: 'Si hay menos en el radio, se usan las del mismo código postal.',
    step: 1,
  },
  {
    key: 'zone_event_pct',
    label: 'Evento de zona',
    unit: '%',
    hint: 'Si este porcentaje de plantas de una zona cae a la vez, es clima o red, no cada planta.',
    step: 1,
  },
];

export const TECHNICAL_FIELDS: FieldMeta[] = [
  {
    key: 'noct_c',
    label: 'NOCT',
    unit: '°C',
    hint: 'Temperatura nominal de operación del panel (hoja de datos).',
    step: 0.5,
  },
  {
    key: 'gamma_pct_per_c',
    label: 'Coeficiente γ',
    unit: '%/°C',
    hint: 'Pérdida de potencia por grado arriba de 25 °C; es negativo.',
    step: 0.01,
  },
  {
    key: 'tilt_deg',
    label: 'Inclinación',
    unit: '°',
    hint: 'Ángulo de los paneles respecto al suelo.',
    step: 1,
  },
  {
    key: 'azimuth_deg',
    label: 'Orientación',
    unit: '°',
    hint: '180° = sur.',
    step: 1,
  },
  {
    key: 'tariff_mxn_per_kwh',
    label: 'Tarifa por omisión',
    unit: 'MXN/kWh',
    hint: 'Para estimar pérdidas y ahorros de clientes sin tarifa propia.',
    step: 0.01,
  },
  {
    key: 'co2_kg_per_kwh',
    label: 'Factor de CO₂',
    unit: 'kg/kWh',
    hint: 'Emisiones evitadas por kWh generado, para los reportes.',
    step: 0.001,
  },
];

export { DEFAULT_SETTINGS };

// Superadmin
export const adminCompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'suspended']),
  plan: z.string(),
  timezone: z.string(),
  brand_color: z.string(),
  ai_monthly_token_budget: z.number(),
  created_at: z.string(),
  plant_count: z.number(),
  ai_tokens_this_month: z.number(),
});
export type AdminCompany = z.infer<typeof adminCompanySchema>;
export const adminCompaniesPage = page(adminCompanySchema);
export const companyCreated = z.object({
  company: adminCompanySchema,
  invitation: z.object({ id: z.uuid(), email: z.string(), expires_at: z.string() }),
});

const jobStatus = z.enum(['running', 'succeeded', 'failed', 'skipped']);
export type JobStatus = z.infer<typeof jobStatus>;
export const healthSchema = z.object({
  generated_at: z.string(),
  jobs: z.array(
    z.object({
      job_name: z.string(),
      last_status: jobStatus,
      last_started_at: z.string(),
      last_finished_at: z.string().nullable(),
      last_success_at: z.string().nullable(),
      failures_24h: z.number(),
    }),
  ),
  recent_failures: z.array(
    z.object({
      job_name: z.string(),
      company: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      started_at: z.string(),
      error: z.string().nullable(),
    }),
  ),
});

/** Tokens legibles: 12 300 → "12.3 mil", 1 000 000 → "1 millón", 1 500 000 → "1.5 millones". */
export function formatTokens(n: number): string {
  const nf = (v: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(v);
  if (n >= 1_000_000) {
    const m = nf(n / 1_000_000);
    return `${m} ${m === '1' ? 'millón' : 'millones'}`;
  }
  if (n >= 1_000) return `${nf(n / 1_000)} mil`;
  return nf(n);
}

import { INVERTER_BRANDS, simulationProfileSchema } from '@pv/core';
import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';
import { latSchema, lonSchema, postalCodeSchema } from '../clients/schemas.js';

// Plantas (specs/03 §solar_plants, specs/10 §Clientes y plantas).

const text = (max: number) => z.string().trim().min(1).max(max);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const plantStatusSchema = z.enum(['active', 'paused', 'decommissioned']);
export const inverterBrandSchema = z.enum(INVERTER_BRANDS);

const plantFields = {
  client_id: z.uuid(),
  name: text(200),
  capacity_kwp: z.number().positive().max(99_999.99),
  tilt_deg: z.number().min(0).max(90),
  azimuth_deg: z.number().min(0).max(360),
  noct_c: z.number().min(30).max(70),
  gamma_pct_per_c: z.number().min(-1).max(-0.05),
  panel_model: nullable(text(200)),
  panel_count: nullable(z.number().int().positive().max(1_000_000)),
  inverter_brand: inverterBrandSchema,
  inverter_model: nullable(text(200)),
  inverter_serial: nullable(text(200)),
  commissioning_date: nullable(z.iso.date({ error: 'Fecha YYYY-MM-DD' })),
  lat: nullable(latSchema),
  lon: nullable(lonSchema),
  postal_code: postalCodeSchema,
  colonia: text(120),
  status: plantStatusSchema,
  simulation_profile: nullable(simulationProfileSchema),
};

// Entrada. Los campos técnicos toman el valor por defecto de la empresa y la ubicación se copia
// del cliente si no se indican.
export const createPlantBody = z
  .object(plantFields)
  .partial({
    tilt_deg: true,
    azimuth_deg: true,
    noct_c: true,
    gamma_pct_per_c: true,
    postal_code: true,
    colonia: true,
    status: true,
  })
  .refine(
    (b) => (b.lat === undefined || b.lat === null) === (b.lon === undefined || b.lon === null),
    {
      error: 'Indica lat y lon juntas',
      path: ['lat'],
    },
  );

export const patchPlantBody = z
  .object(plantFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: 'Indica al menos un campo' });

export const PLANT_SORTS = [
  'name',
  '-name',
  'created_at',
  '-created_at',
  'capacity_kwp',
  '-capacity_kwp',
] as const;

export const plantsQuery = paginationQuery.extend({
  status: plantStatusSchema.optional(),
  postal_code: postalCodeSchema.optional(),
  colonia: z.string().trim().min(1).max(120).optional(),
  brand: inverterBrandSchema.optional(),
  client_id: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(PLANT_SORTS).default('name'),
});

/**
 * Credenciales de inversor: solo de escritura (specs/02). Los nombres de campo dependen del
 * proveedor; se aceptan valores simples y se cifran completos.
 */
export const putCredentialsBody = z.object({
  credentials: z
    .record(
      z.string().trim().min(1).max(100),
      z.union([z.string().max(2000), z.number(), z.boolean()]),
    )
    .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 20, {
      error: 'Indica entre 1 y 20 campos',
    }),
});

// Salida
/** Estado de las credenciales: nunca su contenido. */
export const credentialsStatus = z.object({
  has_credentials: z.boolean(),
  provider: inverterBrandSchema.nullable(),
  updated_at: z.date().nullable(),
  last_test_at: z.date().nullable(),
  last_test_ok: z.boolean().nullable(),
});

export const credentialsTestResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  tested_at: z.date(),
});

export const plantResponse = z.object({
  id: z.uuid(),
  client: z.object({ id: z.uuid(), name: z.string() }),
  name: z.string(),
  capacity_kwp: z.number(),
  tilt_deg: z.number(),
  azimuth_deg: z.number(),
  noct_c: z.number(),
  gamma_pct_per_c: z.number(),
  panel_model: z.string().nullable(),
  panel_count: z.number().int().nullable(),
  inverter_brand: inverterBrandSchema,
  inverter_model: z.string().nullable(),
  inverter_serial: z.string().nullable(),
  commissioning_date: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  postal_code: z.string(),
  colonia: z.string(),
  status: plantStatusSchema,
  last_reading_at: z.date().nullable(),
  last_power_kw: z.number().nullable(),
  simulation_profile: simulationProfileSchema.nullable(),
  credentials: credentialsStatus,
  created_at: z.date(),
  updated_at: z.date(),
});
export const plantsResponse = paginatedSchema(plantResponse);

// Eventos de planta (specs/03 §plant_events, specs/10). rain_cleaning lo crea solo el sistema.
export const manualEventTypeSchema = z.enum(['cleaning', 'repair', 'inverter_replaced', 'note']);

export const createEventBody = z.object({
  type: manualEventTypeSchema,
  occurred_at: z.iso.datetime({ offset: true, error: 'Fecha y hora ISO 8601' }),
  notes: text(2000).nullable().optional(),
});

export const eventsQuery = paginationQuery;

export const eventResponse = z.object({
  id: z.uuid(),
  type: z.enum([
    'cleaning',
    'rain_cleaning',
    'repair',
    'inverter_replaced',
    'commissioning',
    'note',
  ]),
  occurred_at: z.date(),
  source: z.enum(['ticket', 'auto', 'manual']),
  ticket_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.date(),
});

export const eventsResponse = paginatedSchema(eventResponse);

import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';
import { emailSchema } from '../shared-schemas.js';

// Clientes (specs/03 §clients, specs/10 §Clientes y plantas).

const text = (max: number) => z.string().trim().min(1).max(max);
/** Campo opcional que acepta null para borrar el valor. */
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos');
export const latSchema = z.number().min(-90).max(90);
export const lonSchema = z.number().min(-180).max(180);

const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+\d][\d\s()-]{6,}$/, 'Teléfono inválido');
const cfeTariffSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, 'Tarifa CFE inválida (por ejemplo 1F, DAC, PDBT, GDMTH)');
const lowerEmail = emailSchema.transform((e) => e.toLowerCase());

const clientFields = {
  name: text(200),
  contact_name: nullable(text(200)),
  phone: nullable(phoneSchema),
  email: nullable(lowerEmail),
  address: text(300),
  colonia: text(120),
  postal_code: postalCodeSchema,
  city: text(120).optional(),
  state: text(120).optional(),
  lat: latSchema,
  lon: lonSchema,
  cfe_tariff: nullable(cfeTariffSchema),
  avg_monthly_kwh: nullable(z.number().min(0).max(10_000_000)),
  avg_monthly_bill_mxn: nullable(z.number().min(0).max(100_000_000)),
  tariff_mxn_per_kwh: nullable(z.number().positive().max(1000)),
  report_email: nullable(lowerEmail),
};

// Entrada
export const createClientBody = z.object(clientFields);
export const patchClientBody = z
  .object(clientFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: 'Indica al menos un campo' });

export const clientsQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  postal_code: postalCodeSchema.optional(),
  colonia: z.string().trim().min(1).max(120).optional(),
});

// Salida
export const clientResponse = z.object({
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
  plant_count: z.number().int(),
  created_at: z.date(),
  updated_at: z.date(),
});
export const clientsResponse = paginatedSchema(clientResponse);

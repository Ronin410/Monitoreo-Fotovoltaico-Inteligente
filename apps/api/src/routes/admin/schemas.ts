import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';
import { emailSchema } from '../shared-schemas.js';

const slugSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'Zona horaria IANA inválida' },
);

export const brandColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Color hexadecimal, por ejemplo #F59E0B');

// Entrada
export const createCompanyBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  timezone: timezoneSchema.optional(),
  brand_color: brandColorSchema.optional(),
  plan: z.string().trim().min(1).max(40).optional(),
  ai_monthly_token_budget: z.number().int().min(0).optional(),
  admin_email: emailSchema,
});

export const patchCompanyBody = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    plan: z.string().trim().min(1).max(40).optional(),
    ai_monthly_token_budget: z.number().int().min(0).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    error: 'Indica al menos un campo',
  });

export const companiesQuery = paginationQuery.extend({
  status: z.enum(['active', 'suspended']).optional(),
});

// Salida
export const adminCompany = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'suspended']),
  plan: z.string(),
  timezone: z.string(),
  brand_color: z.string(),
  ai_monthly_token_budget: z.number().int(),
  created_at: z.date(),
  plant_count: z.number().int(),
  ai_tokens_this_month: z.number().int(),
});
export const adminCompaniesResponse = paginatedSchema(adminCompany);
export const companyCreatedResponse = z.object({
  company: adminCompany,
  invitation: z.object({
    id: z.uuid(),
    email: z.string(),
    role: z.literal('company_admin'),
    expires_at: z.date(),
  }),
});

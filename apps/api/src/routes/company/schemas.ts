import { companySettingsPatchSchema, companySettingsSchema } from '@pv/core';
import { z } from 'zod';
import { brandColorSchema, timezoneSchema } from '../admin/schemas.js';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';
import { companyRoleSchema, emailSchema, userRoleSchema } from '../shared-schemas.js';

// Entrada
export const usersQuery = paginationQuery;
export const invitationBody = z.object({ email: emailSchema, role: companyRoleSchema });
export const userPatchBody = z
  .object({
    role: companyRoleSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((b) => b.role !== undefined || b.status !== undefined, {
    error: 'Indica role o status',
  });

// Salida
export const companyUser = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
  last_login_at: z.date().nullable(),
  created_at: z.date(),
});
export const companyUsersResponse = paginatedSchema(companyUser);
export const invitationCreatedResponse = z.object({
  id: z.uuid(),
  email: z.string(),
  role: companyRoleSchema,
  expires_at: z.date(),
});

// Empresa (GET/PATCH /company, POST /company/logo)
export const patchCompanyBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    brand_color: brandColorSchema.optional(),
    timezone: timezoneSchema.optional(),
    settings: companySettingsPatchSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    error: 'Indica al menos un campo',
  });

export const companyResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  logo_url: z.string().nullable(),
  brand_color: z.string(),
  timezone: z.string(),
  plan: z.string(),
  ai_monthly_token_budget: z.number().int(),
  /** Settings completos (con valores por defecto). */
  settings: companySettingsSchema,
});

export const logoResponse = z.object({ logo_url: z.string() });
export const logoParams = z.object({
  companyId: z.uuid(),
  file: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|svg)$/),
});

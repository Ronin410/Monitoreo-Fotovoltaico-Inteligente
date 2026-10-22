import { z } from 'zod';
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

import { z } from 'zod';

// Respuestas de la API que usa el frontend (espejo de apps/api/src/routes/**/schemas.ts).

export const userRoleSchema = z.enum(['superadmin', 'company_admin', 'operator', 'technician']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const sessionResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    role: userRoleSchema,
    company_id: z.uuid().nullable(),
  }),
});
export type SessionResponse = z.infer<typeof sessionResponse>;

export const meResponse = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string(), role: userRoleSchema }),
  company: z
    .object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      logo_url: z.string().nullable(),
      brand_color: z.string(),
      timezone: z.string(),
    })
    .nullable(),
  features: z.object({ simulator: z.boolean() }).default({ simulator: false }),
});
export type Me = z.infer<typeof meResponse>;

export const okResponse = z.object({ ok: z.literal(true) });

export const invitationResponse = z.object({
  email: z.string(),
  role: userRoleSchema,
  company_name: z.string(),
});

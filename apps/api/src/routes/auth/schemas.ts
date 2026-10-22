import { z } from 'zod';
import { passwordSchema } from '../../auth/passwords.js';
import { emailSchema, userRoleSchema } from '../shared-schemas.js';

// Entrada
export const loginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const forgotBody = z.object({ email: emailSchema });
export const resetBody = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});
export const acceptBody = z.object({
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
});
export const tokenParam = z.object({ token: z.string().min(1).max(200) });

// Salida
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
export const forgotResponse = z.object({ ok: z.literal(true) });
export const invitationResponse = z.object({
  email: z.string(),
  role: userRoleSchema,
  company_name: z.string(),
});

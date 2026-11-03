import { z } from 'zod';
import { userRoleSchema } from '../shared-schemas.js';

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
  /** Funciones del ambiente que cambian la interfaz (SIMULATOR_ENABLED: staging o demo). */
  features: z.object({ simulator: z.boolean() }),
  /** Términos y aviso de privacidad: versión vigente y si este usuario ya la aceptó. */
  legal: z.object({ version: z.string(), accepted: z.boolean() }),
});

export const acceptTermsBody = z.object({ version: z.string().min(1).max(40) });

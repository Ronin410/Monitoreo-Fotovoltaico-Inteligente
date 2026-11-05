import type { z } from 'zod';
import { EnphaseClient, enphaseCredentialsSchema, type EnphaseClientOptions } from './enphase.js';
import { GoodweClient, goodweCredentialsSchema, type GoodweClientOptions } from './goodwe.js';

export * from './enphase.js';
export * from './goodwe.js';

// Integraciones a nivel empresa (credenciales de la instaladora, no de cada planta): GoodWe, con
// acceso de "usuario de organización" (docs/fabricantes/goodwe-openapi.md), y Enphase, con el plan
// Partner (docs/fabricantes/enphase-api-v4.md).

export type CompanyIntegrationDefinition = {
  /** Valida lo que captura la instaladora. */
  schema: z.ZodType<Record<string, unknown>>;
  /** Prueba la conexión; lanza si falla. */
  test: (
    creds: unknown,
    options?: GoodweClientOptions & EnphaseClientOptions,
  ) => Promise<{ ok: true }>;
};

export const COMPANY_INTEGRATIONS = {
  goodwe: {
    schema: goodweCredentialsSchema,
    test: async (creds, options) => {
      await new GoodweClient(goodweCredentialsSchema.parse(creds), options).testConnection();
      return { ok: true };
    },
  },
  enphase: {
    schema: enphaseCredentialsSchema,
    test: async (creds, options) => {
      await new EnphaseClient(enphaseCredentialsSchema.parse(creds), options).testConnection();
      return { ok: true };
    },
  },
} satisfies Record<string, CompanyIntegrationDefinition>;

export type CompanyIntegrationProvider = keyof typeof COMPANY_INTEGRATIONS;
export const COMPANY_INTEGRATION_PROVIDERS = Object.keys(
  COMPANY_INTEGRATIONS,
) as CompanyIntegrationProvider[];

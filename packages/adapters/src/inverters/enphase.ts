import {
  EnphaseClient,
  enphaseCredentialsSchema,
  enphasePlantCredentialsSchema,
  fetchEnphaseProduction,
} from '../integrations/enphase.js';
import type { InverterAdapter } from './types.js';

// Adaptador de inversores Enphase (API v4, plan Partner). Implementado SOLO con la documentación
// oficial (docs/fabricantes/enphase-api-v4.md). Usa dos juegos de datos:
// - De la empresa (Configuración → Integraciones): API key, Client ID, Client Secret y la cuenta
//   de Enlighten de la instaladora, cifrados.
// - De cada planta: el número de sistema (`system_id`) de Enphase.

/**
 * Enphase cobra cada consulta arriba de 10,000 al mes (plan Partner): se lee cada 2 horas con sol
 * y una vez al cerrar el día, no cada 15 min. Cada consulta trae el día completo, así que no se
 * pierden intervalos (decisión del PO, specs/PREGUNTAS.md #223).
 */
export const ENPHASE_POLL_EVERY_MINUTES = 120;

export const enphaseAdapter: InverterAdapter = {
  provider: 'enphase',
  credentialsSchema: enphasePlantCredentialsSchema,
  pollEveryMinutes: ENPHASE_POLL_EVERY_MINUTES,
  usesCompanyIntegration: true,
  async testConnection(creds, integration) {
    const plant = enphasePlantCredentialsSchema.safeParse(creds);
    if (!plant.success) return { ok: false, message: 'Falta el número de sistema de Enphase' };
    const company = enphaseCredentialsSchema.safeParse(integration);
    if (!company.success) {
      return { ok: false, message: 'Falta conectar la cuenta de Enphase de la empresa' };
    }
    const found = await new EnphaseClient(company.data).hasSystem(plant.data.system_id);
    return found
      ? { ok: true }
      : { ok: false, message: 'La cuenta de Enphase no tiene acceso a ese sistema' };
  },
  async fetchReadings({ creds, integration, since, until }) {
    const plant = enphasePlantCredentialsSchema.parse(creds);
    const client = new EnphaseClient(enphaseCredentialsSchema.parse(integration));
    return fetchEnphaseProduction(client, plant.system_id, since, until);
  },
};

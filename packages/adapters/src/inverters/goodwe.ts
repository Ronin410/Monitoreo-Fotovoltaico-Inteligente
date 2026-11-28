import {
  fetchGoodweProduction,
  GoodweClient,
  goodweCredentialsSchema,
  goodwePlantCredentialsSchema,
} from '../integrations/goodwe.js';
import type { InverterAdapter } from './types.js';

// Adaptador de inversores GoodWe (OpenAPI de SEMS, acceso de "usuario de organización").
// Implementado SOLO con la documentación oficial (docs/fabricantes/goodwe-openapi.md y la
// especificación del portal guardada en docs/fabricantes/goodwe-openapi.json). Usa dos juegos de
// datos:
// - De la empresa (Configuración → Integraciones): Client ID, Client Secret y servidor, cifrados.
// - De cada planta: su ID de planta en SEMS (`plant_id`).

export const goodweAdapter: InverterAdapter = {
  provider: 'goodwe',
  credentialsSchema: goodwePlantCredentialsSchema,
  usesCompanyIntegration: true,
  async testConnection(creds, integration) {
    const plant = goodwePlantCredentialsSchema.safeParse(creds);
    if (!plant.success) return { ok: false, message: 'Falta el ID de la planta en SEMS' };
    const company = goodweCredentialsSchema.safeParse(integration);
    if (!company.success) {
      return { ok: false, message: 'Falta conectar la cuenta de GoodWe de la empresa' };
    }
    // Una hora de serie: confirma el acceso a la planta sin consultar de más.
    const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const { noPermission } = await new GoodweClient(company.data).plantsPowerHistory(
      [plant.data.plant_id],
      new Date(end.getTime() - 3_600_000),
      end,
    );
    return noPermission.includes(plant.data.plant_id)
      ? { ok: false, message: 'La cuenta de GoodWe no tiene acceso a esa planta' }
      : { ok: true };
  },
  async fetchReadings({ creds, integration, since, until }) {
    const plant = goodwePlantCredentialsSchema.parse(creds);
    const client = new GoodweClient(goodweCredentialsSchema.parse(integration));
    return fetchGoodweProduction(client, plant.plant_id, since, until);
  },
};

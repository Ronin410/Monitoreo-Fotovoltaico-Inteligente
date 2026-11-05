import type { InverterAdapter } from './types.js';
import { unimplementedAdapter } from './unimplemented.js';

/**
 * Adaptador de inversores Enphase. SIN IMPLEMENTAR.
 *
 * TODO(enphase): implementar SOLO con la documentación oficial de Enphase y credenciales de prueba
 * entregadas por el PO (CLAUDE.md: "No inventes APIs de fabricantes"; specs/04 §1). No adivinar
 * endpoints, formatos ni límites. Al implementar:
 *   1. credsSchema (zod) con los campos de credenciales que pide el fabricante.
 *   2. Validar con zod cada respuesta del proveedor.
 *   3. testConnection: éxito o fallo genérico, sin repetir datos del proveedor ni credenciales.
 *   4. fetchReadings(since, until): potencia AC, contador diario y temperatura si existen, con
 *      la zona horaria y las unidades que documente el fabricante convertidas a UTC y kW/kWh.
 *   5. Límites de uso del proveedor (429): respetarlos y dejar que el job reintente.
 *   6. Pruebas con respuestas grabadas de la documentación o del ambiente de pruebas.
 */

/**
 * Enphase cobra cada consulta arriba de 10,000 al mes (plan Partner, docs/fabricantes/
 * enphase-api-v4.md): se lee cada 2 horas con sol y una vez al cerrar el día, no cada 15 min. Cada
 * consulta trae el día completo, así que no se pierden intervalos (decisión del PO, #223).
 */
export const ENPHASE_POLL_EVERY_MINUTES = 120;

export const enphaseAdapter: InverterAdapter = {
  ...unimplementedAdapter('enphase'),
  pollEveryMinutes: ENPHASE_POLL_EVERY_MINUTES,
};

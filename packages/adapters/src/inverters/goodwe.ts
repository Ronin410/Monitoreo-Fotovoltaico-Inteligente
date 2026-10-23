import { unimplementedAdapter } from './unimplemented.js';

/**
 * Adaptador de inversores GoodWe. SIN IMPLEMENTAR.
 *
 * TODO(goodwe): implementar SOLO con la documentación oficial de GoodWe y credenciales de prueba
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
export const goodweAdapter = unimplementedAdapter('goodwe');

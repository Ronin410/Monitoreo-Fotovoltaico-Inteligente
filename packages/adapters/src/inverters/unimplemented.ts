import type { InverterBrand } from '@pv/core';
import { NotImplementedError, type InverterAdapter } from './types.js';

/**
 * Adaptador de una marca real sin implementar. Por regla del proyecto (CLAUDE.md, specs/04 §1)
 * no se adivinan endpoints: se implementa solo con documentación oficial y credenciales de prueba
 * entregadas por el PO.
 */
export function unimplementedAdapter(provider: InverterBrand): InverterAdapter {
  const fail = (): never => {
    throw new NotImplementedError(
      `El adaptador ${provider} no está implementado: falta la documentación oficial del fabricante`,
    );
  };
  return {
    provider,
    testConnection: async () => fail(),
    fetchReadings: async () => fail(),
  };
}

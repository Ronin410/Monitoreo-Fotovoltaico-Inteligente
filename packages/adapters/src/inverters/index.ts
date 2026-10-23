import type { InverterBrand } from '@pv/core';
import { createSimulatorAdapter, type SimulatorDataSource } from './simulator.js';
import type { InverterAdapter } from './types.js';
import { unimplementedAdapter } from './unimplemented.js';

export * from './types.js';
export { createSimulatorAdapter, type SimulatorDataSource } from './simulator.js';

export type InverterAdapterRegistry = Record<InverterBrand, InverterAdapter>;

/** Registro de adaptadores por marca (specs/04 §1: adapterRegistry[brand]). */
export function createAdapterRegistry(
  options: { simulator?: SimulatorDataSource } = {},
): InverterAdapterRegistry {
  return {
    simulator: createSimulatorAdapter(options.simulator),
    goodwe: unimplementedAdapter('goodwe'),
    huawei: unimplementedAdapter('huawei'),
    fronius: unimplementedAdapter('fronius'),
    enphase: unimplementedAdapter('enphase'),
    other: unimplementedAdapter('other'),
  };
}

/** Registro sin fuente para el simulador: sirve para probar conexión (api). */
export const adapterRegistry: InverterAdapterRegistry = createAdapterRegistry();

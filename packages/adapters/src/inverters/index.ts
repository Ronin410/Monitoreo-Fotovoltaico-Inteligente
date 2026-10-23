import type { InverterBrand } from '@pv/core';
import { createSimulatorAdapter, type SimulatorDataSource } from './simulator.js';
import type { InverterAdapter } from './types.js';
import { enphaseAdapter } from './enphase.js';
import { froniusAdapter } from './fronius.js';
import { goodweAdapter } from './goodwe.js';
import { huaweiAdapter } from './huawei.js';
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
    goodwe: goodweAdapter,
    huawei: huaweiAdapter,
    fronius: froniusAdapter,
    enphase: enphaseAdapter,
    // "Otra marca": sin integración; la planta se registra pero no se lee.
    other: unimplementedAdapter('other'),
  };
}

/** Registro sin fuente para el simulador: sirve para probar conexión (api). */
export const adapterRegistry: InverterAdapterRegistry = createAdapterRegistry();

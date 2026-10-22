import type { InverterBrand } from '@pv/core';
import { simulatorAdapter } from './simulator.js';
import type { InverterAdapter } from './types.js';
import { unimplementedAdapter } from './unimplemented.js';

export * from './types.js';

/** Registro de adaptadores por marca (specs/04 §1: adapterRegistry[brand]). */
export const adapterRegistry: Record<InverterBrand, InverterAdapter> = {
  simulator: simulatorAdapter,
  goodwe: unimplementedAdapter('goodwe'),
  huawei: unimplementedAdapter('huawei'),
  fronius: unimplementedAdapter('fronius'),
  enphase: unimplementedAdapter('enphase'),
  other: unimplementedAdapter('other'),
};

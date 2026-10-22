import { NotImplementedError, type InverterAdapter } from './types.js';

/**
 * Inversor simulado (specs/04 §3). No necesita credenciales reales; genera la telemetría a partir
 * del clima guardado de la planta (fetchReadings llega en F3-T3).
 */
export const simulatorAdapter: InverterAdapter = {
  provider: 'simulator',
  testConnection: async () => ({ ok: true }),
  fetchReadings: async () => {
    throw new NotImplementedError('La telemetría simulada se implementa en F3-T3');
  },
};

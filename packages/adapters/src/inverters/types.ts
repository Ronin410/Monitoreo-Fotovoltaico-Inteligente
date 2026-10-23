import type { InverterBrand, SimulationProfile } from '@pv/core';

// Interfaz de adaptadores de inversor (specs/04 §1).

export type RawReading = {
  /** Marca de tiempo del proveedor. */
  ts: Date;
  /** Potencia AC instantánea o promedio. */
  powerKw: number;
  /** Contador diario del inversor. */
  energyTodayKwh?: number;
  inverterTempC?: number;
  statusCode?: string;
};

export type PlantForAdapter = {
  id: string;
  capacityKwp: number;
  serial: string | null;
  lat: number | null;
  lon: number | null;
  simulationProfile: SimulationProfile | null;
  /** Para el simulador: parámetros del panel y zona horaria de la empresa. */
  noctC: number;
  gammaPctPerC: number;
  timezone: string;
};

export type ConnectionTestResult = { ok: boolean; message?: string };

export interface InverterAdapter {
  readonly provider: InverterBrand;
  /** Recibe las credenciales descifradas, solo en memoria. */
  testConnection(creds: unknown): Promise<ConnectionTestResult>;
  fetchReadings(args: {
    plant: PlantForAdapter;
    creds: unknown;
    since: Date;
    until: Date;
  }): Promise<RawReading[]>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

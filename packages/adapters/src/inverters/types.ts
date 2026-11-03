import type { InverterBrand, SimulationProfile } from '@pv/core';
import type { z } from 'zod';

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
  /**
   * Campos de credenciales que pide el fabricante. Si existe, la API los valida al guardar; las
   * marcas sin adaptador aceptan campos libres.
   */
  readonly credentialsSchema?: z.ZodType;
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

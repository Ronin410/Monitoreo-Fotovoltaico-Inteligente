// Interfaz de proveedores de clima (specs/04 §2).
// Convención interna de azimut: 180 = sur, 90 = este, 270 = oeste. Cada adaptador convierte a la
// de su proveedor.

export type WeatherHour = {
  /** Inicio de la hora, UTC. */
  ts: Date;
  /** Irradiancia en el plano inclinado (W/m², promedio de la hora). */
  poaWm2: number;
  ghiWm2: number;
  tempAmbC: number;
  cloudCoverPct: number;
  precipitationMm: number;
};

export type WeatherRequest = {
  lat: number;
  lon: number;
  tiltDeg: number;
  azimuthDeg: number;
  /** Inicio (inclusive) y fin (exclusivo), alineados a la hora UTC. */
  from: Date;
  to: Date;
};

export interface WeatherProvider {
  readonly name: string;
  fetchHourly(args: WeatherRequest): Promise<WeatherHour[]>;
}

const HOUR_MS = 3_600_000;

/** Inicios de hora UTC en [from, to). */
export function hoursBetween(from: Date, to: Date): Date[] {
  const start = Math.ceil(from.getTime() / HOUR_MS) * HOUR_MS;
  const hours: Date[] = [];
  for (let t = start; t < to.getTime(); t += HOUR_MS) hours.push(new Date(t));
  return hours;
}

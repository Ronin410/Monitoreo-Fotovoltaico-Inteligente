import { sunPosition } from '../solar.js';
import type { AlertAction, AlertThresholds, OpenAlert } from './types.js';

// specs/06 §2 — offline: más de `offline_hours` horas CON SOL sin lecturas. Se evalúa cada hora.

const STEP_MS = 5 * 60_000;

/** Horas con sol (elevación > 0) en [from, to), en pasos de 5 minutos. */
export function sunHoursBetween(from: Date, to: Date, lat: number, lon: number): number {
  let steps = 0;
  for (let t = from.getTime(); t < to.getTime(); t += STEP_MS) {
    if (sunPosition(new Date(t + STEP_MS / 2), lat, lon).elevationDeg > 0) steps++;
  }
  return (steps * STEP_MS) / 3_600_000;
}

export type OfflineInput = {
  now: Date;
  lat: number;
  lon: number;
  /** Última lectura; si nunca hubo, desde cuándo se esperan (alta o puesta en marcha). */
  lastReadingAt: Date | null;
  expectedSince: Date;
  /** El último intento de ingesta falló por nuestra integración (provider_error). */
  providerError: boolean;
  open: (OpenAlert & { detectedAt: Date }) | undefined;
  thresholds: Pick<AlertThresholds, 'offline_hours'>;
};

export function evaluateOffline(input: OfflineInput): AlertAction | null {
  const { open } = input;
  if (open) {
    if (input.lastReadingAt && input.lastReadingAt > open.detectedAt) {
      return { kind: 'resolve', type: 'offline', reason: 'readings_resumed' };
    }
    return null;
  }
  // Un error de nuestra integración no es una falla de la planta: se muestra como "problema de
  // conexión", sin alerta.
  if (input.providerError) return null;
  const since = input.lastReadingAt ?? input.expectedSince;
  const hours = sunHoursBetween(since, input.now, input.lat, input.lon);
  if (hours <= input.thresholds.offline_hours) return null;
  return {
    kind: 'open',
    type: 'offline',
    severity: 'critical',
    trigger: { dates: [], deviation_pct: [] },
  };
}

// specs/05 §8 — Estado diario de la planta, en orden de prioridad.

export type DailyStatus = 'ok' | 'warning' | 'critical' | 'offline' | 'no_data';

export function dailyStatus(input: {
  hasWeather: boolean;
  /** Hubo telemetría con sol ese día. */
  hasTelemetry: boolean;
  /** Severidades de las alertas abiertas de la planta. */
  openAlertSeverities: ('info' | 'warning' | 'critical')[];
  deviationPct: number | null;
  daysToCleaning: number | null;
  soilingDeviationPct: number;
}): DailyStatus {
  if (!input.hasWeather) return 'no_data';
  if (!input.hasTelemetry) return 'offline';
  if (input.openAlertSeverities.includes('critical')) return 'critical';
  if (
    (input.deviationPct !== null && input.deviationPct > input.soilingDeviationPct) ||
    (input.daysToCleaning !== null && input.daysToCleaning <= 7) ||
    input.openAlertSeverities.includes('warning')
  ) {
    return 'warning';
  }
  return 'ok';
}

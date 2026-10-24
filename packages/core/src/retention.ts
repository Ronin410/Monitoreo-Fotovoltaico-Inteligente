// Retención de datos crudos (specs/03 §telemetry_readings): las lecturas de 15 min se conservan
// 13 meses; las métricas diarias, siempre.

export const TELEMETRY_RETENTION_MONTHS = 13;

/**
 * Primer día local (YYYY-MM-DD) que se conserva: el mismo día de hace 13 meses (o el último día de
 * ese mes si no existe, p. ej. 31 de marzo → 28 o 29 de febrero).
 */
export function telemetryRetentionStart(
  today: string,
  months = TELEMETRY_RETENTION_MONTHS,
): string {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

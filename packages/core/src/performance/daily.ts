import { computeHour, type HourInput, type PanelParams } from './hourly.js';

// specs/05 §2 (agregados diarios) y §3 (día válido).

export type DayHourInput = HourInput & {
  cloudCoverPct?: number | null;
  precipitationMm?: number | null;
};

export type DayThresholds = {
  min_valid_irradiation_kwh_m2: number;
  min_data_completeness_pct: number;
};

export type InvalidReason = 'low_irradiation' | 'incomplete_data' | 'offline' | 'no_weather';

export type DayResult = {
  /** Energía real de todo el día (para reportes), incluye horas no cubiertas. */
  energyKwh: number;
  irradiationPoaKwhM2: number;
  expectedStcKwh: number;
  expectedTempKwh: number;
  specificYieldKwhKwp: number;
  /** Σ E_real / Σ E_stc de las horas cubiertas; null sin horas cubiertas con sol. */
  pr: number | null;
  /** Σ E_real / Σ E_exp de las horas cubiertas. */
  prTemp: number | null;
  dataCompletenessPct: number;
  tempAmbMaxC: number | null;
  tCellMaxC: number | null;
  cloudCoverAvgPct: number | null;
  rainMm: number;
  hasWeather: boolean;
  hasTelemetry: boolean;
  isValidDay: boolean;
  invalidReason: InvalidReason | null;
};

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

/**
 * `hours`: las horas del día local de la planta. `hasTelemetry`: hubo al menos una lectura con
 * sol ese día (no basta con energía 0 calculada).
 */
export function computeDay(
  hours: DayHourInput[],
  panel: PanelParams,
  thresholds: DayThresholds,
  hasTelemetry: boolean,
): DayResult {
  const results = hours.map((h) => ({ input: h, r: computeHour(h, panel) }));
  const withWeather = results.filter(({ r }) => r.hasWeather);
  const covered = results.filter(({ r }) => r.covered && r.expectedStcKwh > 0);

  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const energyKwh = sum(results.map(({ r }) => r.energyKwh));
  const irradiation = sum(withWeather.map(({ r }) => r.irradiationKwhM2));
  const expectedStc = sum(withWeather.map(({ r }) => r.expectedStcKwh));
  const expectedTemp = sum(withWeather.map(({ r }) => r.expectedTempKwh));

  // Numerador y denominador sobre las mismas horas: una hora sin datos no castiga el PR.
  const realCovered = sum(covered.map(({ r }) => r.energyKwh));
  const stcCovered = sum(covered.map(({ r }) => r.expectedStcKwh));
  const expCovered = sum(covered.map(({ r }) => r.expectedTempKwh));
  const sunnyStc = sum(
    withWeather.filter(({ r }) => r.expectedStcKwh > 0).map(({ r }) => r.expectedStcKwh),
  );

  // Completitud ponderada por irradiancia: perder el mediodía pesa más que perder las 7:00.
  const completeness = sunnyStc > 0 ? (100 * stcCovered) / sunnyStc : 0;

  const clouds = withWeather
    .map(({ input }) => input.cloudCoverPct)
    .filter((c): c is number => c != null);

  const hasWeather = withWeather.length > 0;
  // Orden de prioridad del motivo: sin clima no se puede evaluar nada; sin telemetría la planta
  // está desconectada; después irradiación y completitud.
  let invalidReason: InvalidReason | null = null;
  if (!hasWeather) invalidReason = 'no_weather';
  else if (!hasTelemetry) invalidReason = 'offline';
  else if (irradiation < thresholds.min_valid_irradiation_kwh_m2) invalidReason = 'low_irradiation';
  else if (completeness < thresholds.min_data_completeness_pct) invalidReason = 'incomplete_data';

  return {
    energyKwh,
    irradiationPoaKwhM2: irradiation,
    expectedStcKwh: expectedStc,
    expectedTempKwh: expectedTemp,
    specificYieldKwhKwp: panel.capacityKwp > 0 ? energyKwh / panel.capacityKwp : 0,
    pr: stcCovered > 0 ? realCovered / stcCovered : null,
    prTemp: expCovered > 0 ? realCovered / expCovered : null,
    dataCompletenessPct: completeness,
    tempAmbMaxC: max(withWeather.map(({ input }) => input.tempAmbC as number)),
    tCellMaxC: max(withWeather.map(({ r }) => r.tCellC as number)),
    cloudCoverAvgPct: clouds.length ? sum(clouds) / clouds.length : null,
    rainMm: sum(withWeather.map(({ input }) => input.precipitationMm ?? 0)),
    hasWeather,
    hasTelemetry,
    isValidDay: invalidReason === null,
    invalidReason,
  };
}

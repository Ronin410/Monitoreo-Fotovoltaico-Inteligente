// specs/05 §7 — Tendencia de suciedad y predicción de lavado.

export type ResetEventType = 'cleaning' | 'rain_cleaning' | 'repair';
export type PlantEventLike = { type: string; occurredAt: Date };

export const SOILING_MIN_POINTS = 7;
const MIN_SLOPE = -0.05;
const MAX_PREDICTION_DAYS = 120;
/**
 * Tolerancia de punto flotante: con una recta ajustada, r_hoy puede salir 94.00000000000001 y la
 * división quedar apenas sobre un entero; sin tolerancia ceil sumaría un día de más.
 */
const EPS = 1e-9;

export type SoilingPoint = {
  /** Días desde una referencia fija (por ejemplo desde el reinicio). */
  day: number;
  /** r = PR_temp / línea base, en %. */
  rPct: number;
};

export type Confidence = 'low' | 'medium' | 'high';

export type SoilingPrediction = {
  slopePctPerDay: number | null;
  r2: number | null;
  /** Valor de la recta hoy (%). */
  rTodayPct: number | null;
  daysToCleaning: number | null;
  confidence: Confidence | null;
  points: number;
};

/** El reinicio más reciente (limpieza, lavado por lluvia o reparación) hasta `until`. */
export function lastResetEvent<T extends PlantEventLike>(events: T[], until: Date): T | null {
  const resets = events.filter(
    (e) => ['cleaning', 'rain_cleaning', 'repair'].includes(e.type) && e.occurredAt <= until,
  );
  return resets.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null;
}

/** Mínimos cuadrados de y contra x. */
export function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  // Con y constante la recta explica todo (no hay variación que explicar).
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/**
 * Predicción a partir de la recta (días hasta cruzar el umbral r_th = 100 − soiling_deviation_pct).
 * Separada para poder probar el caso C de specs/05 §10 directamente.
 */
export function daysToCleaning(
  rTodayPct: number,
  slopePctPerDay: number,
  thresholdPct: number,
): number | null {
  if (rTodayPct <= thresholdPct) return 0;
  if (slopePctPerDay < MIN_SLOPE) {
    const days = Math.ceil((rTodayPct - thresholdPct) / -slopePctPerDay - EPS);
    return days > MAX_PREDICTION_DAYS ? null : days;
  }
  return null;
}

export function confidenceOf(r2: number, n: number): Confidence {
  if (r2 >= 0.7 && n >= 14) return 'high';
  if (r2 >= 0.4) return 'medium';
  return 'low';
}

/**
 * `points`: días válidos desde el último reinicio hasta hoy. Con menos de 7 puntos no hay
 * predicción (todo null).
 */
export function predictSoiling(
  points: SoilingPoint[],
  today: number,
  soilingDeviationPct: number,
): SoilingPrediction {
  if (points.length < SOILING_MIN_POINTS) {
    return {
      slopePctPerDay: null,
      r2: null,
      rTodayPct: null,
      daysToCleaning: null,
      confidence: null,
      points: points.length,
    };
  }
  const fit = linearRegression(points.map((p) => ({ x: p.day, y: p.rPct })));
  const rToday = fit.intercept + fit.slope * today;
  return {
    slopePctPerDay: fit.slope,
    r2: fit.r2,
    rTodayPct: rToday,
    daysToCleaning: daysToCleaning(rToday, fit.slope, 100 - soilingDeviationPct),
    confidence: confidenceOf(fit.r2, points.length),
    points: points.length,
  };
}

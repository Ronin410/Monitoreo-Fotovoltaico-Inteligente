// specs/05 §4 (línea base) y §5 (desviación).

export type BaselineDay = {
  /** YYYY-MM-DD local. */
  date: string;
  prTemp: number | null;
  isValidDay: boolean;
  /** Ese día tenía una alerta sudden_drop activa: no representa a la planta sana. */
  suddenDropActive: boolean;
};

export type BaselineSource = 'own' | 'neighbors' | 'default';

export const BASELINE_WINDOW_DAYS = 90;
export const BASELINE_MIN_DAYS = 10;
export const DEFAULT_BASELINE = 0.85;

const DAY_MS = 24 * 3_600_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** Percentil con interpolación lineal entre rangos (método "R-7", el de Excel/NumPy). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('percentile de una lista vacía');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] as number;
  const hiV = sorted[hi] as number;
  return loV + (hiV - loV) * (rank - lo);
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

/**
 * Línea base del día `date`:
 * - propia: P80 de PR_temp de los días válidos de los 90 días anteriores (sin el día evaluado y
 *   sin días con sudden_drop activo), si hay al menos 10. Se usa P80 y no el promedio para no
 *   "aprender" la suciedad acumulada de la temporada seca como normal;
 * - provisional: mediana de las líneas base propias de las vecinas;
 * - si tampoco hay: 0.85.
 */
export function computeBaseline(
  date: string,
  history: BaselineDay[],
  neighborOwnBaselines: number[] = [],
): { value: number; source: BaselineSource } {
  const today = dayNumber(date);
  const samples = history
    .filter((d) => {
      const n = dayNumber(d.date);
      return n < today && n >= today - BASELINE_WINDOW_DAYS;
    })
    .filter((d) => d.isValidDay && !d.suddenDropActive && d.prTemp !== null)
    .map((d) => d.prTemp as number);
  if (samples.length >= BASELINE_MIN_DAYS) return { value: percentile(samples, 80), source: 'own' };
  if (neighborOwnBaselines.length > 0) {
    return { value: median(neighborOwnBaselines), source: 'neighbors' };
  }
  return { value: DEFAULT_BASELINE, source: 'default' };
}

/** Positiva = la planta rinde por debajo de su normal (%). */
export function deviationPct(prBaseline: number, prTemp: number): number {
  return (100 * (prBaseline - prTemp)) / prBaseline;
}

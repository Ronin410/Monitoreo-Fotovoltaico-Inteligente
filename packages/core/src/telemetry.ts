// Normalización de lecturas de inversor a intervalos de 15 min (specs/04 §1 "Normalización").
// Función pura: el job ingest.telemetry la aplica y guarda el resultado.

export const INTERVAL_MS = 15 * 60_000;
const INTERVAL_HOURS = 0.25;
/** Hueco máximo en el que se reparte la diferencia del contador (1 hora). */
const MAX_FILL_GAP_INTERVALS = 4;

export type InputReading = {
  ts: Date;
  powerKw: number;
  energyTodayKwh?: number | null;
  inverterTempC?: number | null;
  statusCode?: string | null;
};

export type NormalizedInterval = {
  /** Inicio del intervalo de 15 min, UTC. */
  ts: Date;
  /** Promedio de las lecturas del intervalo. */
  powerKw: number;
  /** Energía de este intervalo (kWh). */
  energyKwh: number;
  /** Último valor del contador diario en el intervalo. */
  energyTodayKwh: number | null;
  inverterTempC: number | null;
  statusCode: string | null;
  /**
   * `true` si el intervalo no tuvo lecturas y se rellenó repartiendo la diferencia del contador
   * (hueco ≤ 1 h).
   */
  filled: boolean;
};

/** Último intervalo ya guardado antes de la ventana, para calcular diferencias del contador. */
export type PreviousInterval = { ts: Date; energyTodayKwh: number | null };

export function floorToInterval(ts: Date): Date {
  return new Date(Math.floor(ts.getTime() / INTERVAL_MS) * INTERVAL_MS);
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * 1. Agrupa en intervalos de 15 min. 2. Potencia = promedio. 3. Energía:
 *    - con contador diario en el intervalo y en el anterior: diferencia; si el contador bajó
 *      (reinicio a medianoche) se toma el valor actual; con un hueco ≤ 1 h la diferencia se
 *      reparte entre los intervalos faltantes; con un hueco mayor se usa la potencia;
 *    - sin contador: potencia × 0.25 h.
 */
export function normalizeReadings(
  readings: InputReading[],
  previous: PreviousInterval | null = null,
): NormalizedInterval[] {
  const groups = new Map<number, InputReading[]>();
  for (const r of readings) {
    if (!Number.isFinite(r.powerKw)) continue;
    const key = floorToInterval(r.ts).getTime();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const intervals = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.ts.getTime() - b.ts.getTime());
      const counters = sorted.map((r) => r.energyTodayKwh).filter((v): v is number => v != null);
      const temps = sorted.map((r) => r.inverterTempC).filter((v): v is number => v != null);
      return {
        ts: new Date(key),
        powerKw: Math.max(0, sorted.reduce((s, r) => s + r.powerKw, 0) / sorted.length),
        energyTodayKwh: counters.at(-1) ?? null,
        inverterTempC: temps.length ? temps.reduce((s, t) => s + t, 0) / temps.length : null,
        statusCode: sorted.findLast((r) => r.statusCode != null)?.statusCode ?? null,
      };
    });

  const result: NormalizedInterval[] = [];
  let prev: PreviousInterval | null = previous;
  for (const cur of intervals) {
    const byPower = cur.powerKw * INTERVAL_HOURS;
    let energy = byPower;
    const gap = prev ? Math.round((cur.ts.getTime() - prev.ts.getTime()) / INTERVAL_MS) : null;

    if (
      prev &&
      gap !== null &&
      gap >= 1 &&
      cur.energyTodayKwh !== null &&
      prev.energyTodayKwh !== null
    ) {
      if (gap > MAX_FILL_GAP_INTERVALS) {
        energy = byPower; // Hueco mayor a 1 h: no se sabe cómo se repartió; método de potencia.
      } else if (cur.energyTodayKwh < prev.energyTodayKwh) {
        energy = cur.energyTodayKwh; // El contador se reinició (medianoche).
      } else {
        const diff = cur.energyTodayKwh - prev.energyTodayKwh;
        energy = diff / gap;
        // Rellena los intervalos faltantes del hueco con su parte de la diferencia.
        for (let i = 1; i < gap; i++) {
          const ts = new Date(prev.ts.getTime() + i * INTERVAL_MS);
          result.push({
            ts,
            powerKw: round4(energy / INTERVAL_HOURS),
            energyKwh: round4(energy),
            energyTodayKwh: null,
            inverterTempC: null,
            statusCode: null,
            filled: true,
          });
        }
      }
    }

    result.push({
      ...cur,
      powerKw: round4(cur.powerKw),
      energyKwh: round4(Math.max(0, energy)),
      inverterTempC: cur.inverterTempC === null ? null : Math.round(cur.inverterTempC * 100) / 100,
      filled: false,
    });
    prev = { ts: cur.ts, energyTodayKwh: cur.energyTodayKwh };
  }
  return result;
}

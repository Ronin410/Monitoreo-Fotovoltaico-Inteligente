import { addDays, daysBetween } from '../time.js';
import type { AlertDay, AlertPlantEvent, AlertTrigger, AlertType } from './types.js';

// specs/06 §3 — Evidencia de una alerta: lo que la disparó y el contexto de los últimos 14 días.
// Es lo que se muestra en el detalle y lo que recibe la IA para explicarla.

export type EvidenceDay = AlertDay & {
  prTemp: number | null;
  prBaseline: number | null;
  baselineSource: 'own' | 'neighbors' | 'default' | null;
  neighborCount: number | null;
  cloudCoverAvgPct: number | null;
  tempAmbMaxC: number | null;
};

export type AlertEvidence = {
  rule: AlertType;
  trigger: AlertTrigger;
  baseline: { value: number | null; source: EvidenceDay['baselineSource'] };
  trend: {
    slope_pct_per_day: number | null;
    /** Confianza de la predicción de lavado (`plant_daily_metrics` no guarda r²). */
    confidence: EvidenceDay['predictionConfidence'];
    days_to_cleaning: number | null;
    days_since_reset: number | null;
    last_reset: { type: string; date: string } | null;
  };
  neighbors: { count: number | null; neighbor_index: number | null };
  weather: {
    rain_mm_14d: number;
    cloud_cover_avg_pct_3d: number | null;
    temp_amb_max_c_3d: number | null;
  };
  last_14_days: {
    date: string;
    pr_temp: number | null;
    deviation_pct: number | null;
    neighbor_index: number | null;
    rain_mm: number | null;
    valid: boolean;
    zone_event: boolean;
  }[];
  cleaning_did_not_recover: boolean;
};

const round = (v: number | null, digits = 4) =>
  v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits;

const RESET_TYPES = ['cleaning', 'rain_cleaning', 'repair'];

export function buildEvidence(input: {
  rule: AlertType;
  trigger: AlertTrigger;
  today: string;
  /** Métricas de la planta (las que tengan fecha ≤ hoy; se usan los últimos 14 días). */
  days: EvidenceDay[];
  events: AlertPlantEvent[];
  cleaningDidNotRecover?: boolean;
}): AlertEvidence {
  const from14 = addDays(input.today, -13);
  const from3 = addDays(input.today, -2);
  const recent = input.days
    .filter((d) => d.date >= from14 && d.date <= input.today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last3 = recent.filter((d) => d.date >= from3);
  const today = recent.find((d) => d.date === input.today);

  const reset = input.events
    .filter((e) => RESET_TYPES.includes(e.type) && e.date <= input.today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const clouds = last3.map((d) => d.cloudCoverAvgPct).filter((v): v is number => v !== null);
  const temps = last3.map((d) => d.tempAmbMaxC).filter((v): v is number => v !== null);

  return {
    rule: input.rule,
    trigger: input.trigger,
    baseline: { value: round(today?.prBaseline ?? null), source: today?.baselineSource ?? null },
    trend: {
      slope_pct_per_day: round(today?.soilingSlopePctPerDay ?? null, 3),
      confidence: today?.predictionConfidence ?? null,
      days_to_cleaning: today?.daysToCleaning ?? null,
      days_since_reset: reset ? daysBetween(reset.date, input.today) : null,
      last_reset: reset ? { type: reset.type, date: reset.date } : null,
    },
    neighbors: {
      count: today?.neighborCount ?? null,
      neighbor_index: round(today?.neighborIndex ?? null),
    },
    weather: {
      rain_mm_14d: round(
        recent.reduce((s, d) => s + (d.rainMm ?? 0), 0),
        2,
      ) as number,
      cloud_cover_avg_pct_3d: clouds.length
        ? round(clouds.reduce((s, v) => s + v, 0) / clouds.length, 1)
        : null,
      temp_amb_max_c_3d: temps.length ? round(Math.max(...temps), 1) : null,
    },
    last_14_days: recent.map((d) => ({
      date: d.date,
      pr_temp: round(d.prTemp),
      deviation_pct: round(d.deviationPct, 2),
      neighbor_index: round(d.neighborIndex),
      rain_mm: round(d.rainMm, 2),
      valid: d.isValidDay,
      zone_event: d.zoneEvent,
    })),
    cleaning_did_not_recover: input.cleaningDidNotRecover ?? false,
  };
}

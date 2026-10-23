import { daysBetween } from '../time.js';
import type {
  AlertAction,
  AlertDay,
  AlertPlantEvent,
  AlertSeverity,
  AlertThresholds,
  AlertTrigger,
  OpenAlert,
} from './types.js';

// specs/06 §2 — Reglas diarias de una planta: sudden_drop, soiling y cleaning_due_soon. Se
// evalúan en ese orden porque cada una depende del resultado de la anterior.

/** Desviación previa máxima para que una caída cuente como brusca (crítica / advertencia). */
const CRITICAL_PREV_MAX = 15;
const WARNING_PREV_MAX = 10;
const WARNING_DEVIATION = 20;
const WARNING_NEIGHBOR_INDEX = 0.8;
/** sudden_drop se resuelve con desviación < 10 % en 2 días válidos. */
const DROP_RECOVERED = 10;
/** soiling se resuelve con desviación < 5 %. */
const SOILING_RECOVERED = 5;
/** La racha de soiling debe caber en 7 días calendario. */
const SOILING_STREAK_SPAN_DAYS = 7;
const DUE_SOON_MAX_DAYS = 7;
const RESET_EVENTS = ['cleaning', 'rain_cleaning'];

export type DailyAlertInput = {
  /** Fecha local evaluada; `days` debe incluirla para que algo se dispare. */
  today: string;
  /** Métricas diarias de la planta hasta `today` (bastan ~30 días), en cualquier orden. */
  days: AlertDay[];
  events: AlertPlantEvent[];
  open: { sudden_drop?: OpenAlert; soiling?: OpenAlert; cleaning_due_soon?: OpenAlert };
  thresholds: AlertThresholds;
};

const triggerOf = (days: AlertDay[]): AlertTrigger => ({
  dates: days.map((d) => d.date),
  deviation_pct: days.map((d) => d.deviationPct),
});

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
const maxSeverity = (a: AlertSeverity, b: AlertSeverity) =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

/** Días válidos con desviación, hasta hoy, en orden. */
function validDays(input: DailyAlertInput): AlertDay[] {
  return input.days
    .filter((d) => d.date <= input.today && d.isValidDay && d.deviationPct !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Días que pueden disparar sudden_drop y soiling: válidos y sin evento de zona. */
const eligible = (valid: AlertDay[]) => valid.filter((d) => !d.zoneEvent);
const dev = (d: AlertDay) => d.deviationPct as number;

/** Condición de sudden_drop hoy, o null. */
function suddenDropTrigger(
  input: DailyAlertInput,
  valid: AlertDay[],
): { severity: AlertSeverity; days: AlertDay[] } | null {
  const e = eligible(valid);
  const [d3, d2, d1] = [e.at(-3), e.at(-2), e.at(-1)];
  if (!d1 || d1.date !== input.today || !d2) return null;
  if (dev(d1) >= input.thresholds.sudden_drop_pct && dev(d2) < CRITICAL_PREV_MAX) {
    return { severity: 'critical', days: [d2, d1] };
  }
  if (
    d3 &&
    dev(d1) >= WARNING_DEVIATION &&
    dev(d2) >= WARNING_DEVIATION &&
    dev(d3) < WARNING_PREV_MAX &&
    (d1.neighborIndex === null || d1.neighborIndex < WARNING_NEIGHBOR_INDEX)
  ) {
    return { severity: 'warning', days: [d3, d2, d1] };
  }
  return null;
}

function evaluateSuddenDrop(input: DailyAlertInput, valid: AlertDay[]): AlertAction | null {
  const open = input.open.sudden_drop;
  const trigger = suddenDropTrigger(input, valid);
  if (open) {
    const after = valid.filter((d) => d.date > open.detectedOn).slice(-2);
    if (after.length === 2 && after.every((d) => dev(d) < DROP_RECOVERED)) {
      return { kind: 'resolve', type: 'sudden_drop', reason: 'recovered' };
    }
    return {
      kind: 'update',
      type: 'sudden_drop',
      severity: trigger ? maxSeverity(open.severity, trigger.severity) : open.severity,
      ...(trigger && { trigger: triggerOf(trigger.days) }),
    };
  }
  return trigger
    ? {
        kind: 'open',
        type: 'sudden_drop',
        severity: trigger.severity,
        trigger: triggerOf(trigger.days),
      }
    : null;
}

/** Condición de soiling hoy: los días de la racha, o null. */
function soilingTrigger(
  input: DailyAlertInput,
  valid: AlertDay[],
  suddenDropActive: boolean,
): AlertDay[] | null {
  const t = input.thresholds;
  // Los días inválidos o con evento de zona se saltan sin romper la racha.
  const streak = eligible(valid).slice(-t.soiling_consecutive_days);
  const first = streak[0];
  const last = streak.at(-1);
  if (!first || !last || streak.length < t.soiling_consecutive_days) return null;
  if (last.date !== input.today) return null;
  if (daysBetween(first.date, last.date) >= SOILING_STREAK_SPAN_DAYS) return null;
  if (!streak.every((d) => dev(d) > t.soiling_deviation_pct)) return null;
  const rained = input.days.some(
    (d) => d.date >= first.date && d.date <= last.date && (d.rainMm ?? 0) >= t.rain_reset_mm,
  );
  if (rained) return null;
  // Con una caída brusca activa la desviación no es suciedad, aunque la recta baje: la caída
  // misma inclina la regresión (specs/PREGUNTAS.md #103, opción conservadora).
  if (suddenDropActive) return null;
  const slope = last.soilingSlopePctPerDay;
  if (slope !== null && slope >= 0) return null;
  return streak;
}

function evaluateSoiling(
  input: DailyAlertInput,
  valid: AlertDay[],
  suddenDropActive: boolean,
): AlertAction | null {
  const t = input.thresholds;
  const open = input.open.soiling;
  const streak = soilingTrigger(input, valid, suddenDropActive);
  if (!open) {
    return streak
      ? { kind: 'open', type: 'soiling', severity: 'warning', trigger: triggerOf(streak) }
      : null;
  }

  // Lavado (manual o por lluvia) desde que se abrió la alerta: se mira el rendimiento de los
  // días válidos posteriores (el día del lavado mezcla horas sucias y limpias).
  const resets = input.events
    .filter(
      (e) => RESET_EVENTS.includes(e.type) && e.date >= open.detectedOn && e.date <= input.today,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const reset = resets.at(-1);
  let cleaningDidNotRecover = open.cleaningDidNotRecover ?? false;
  let reexplain = false;
  if (reset) {
    const afterReset = valid.filter((d) => d.date > reset.date);
    const [first, second] = afterReset;
    if (first && dev(first) < SOILING_RECOVERED) {
      return { kind: 'resolve', type: 'soiling', reason: 'cleaning_recovered' };
    }
    if (
      first &&
      second &&
      dev(first) > t.soiling_deviation_pct &&
      dev(second) > t.soiling_deviation_pct &&
      !cleaningDidNotRecover
    ) {
      cleaningDidNotRecover = true;
      reexplain = true;
    }
  }
  const recent = valid.filter((d) => d.date > open.detectedOn).slice(-2);
  if (recent.length === 2 && recent.every((d) => dev(d) < SOILING_RECOVERED)) {
    return { kind: 'resolve', type: 'soiling', reason: 'recovered' };
  }
  return {
    kind: 'update',
    type: 'soiling',
    severity: open.severity,
    ...(streak && { trigger: triggerOf(streak) }),
    ...(cleaningDidNotRecover && { cleaningDidNotRecover }),
    ...(reexplain && { reexplain }),
  };
}

function evaluateCleaningDueSoon(
  input: DailyAlertInput,
  soilingOpen: boolean,
  suddenDropActive: boolean,
): AlertAction | null {
  const open = input.open.cleaning_due_soon;
  const today = input.days.find((d) => d.date === input.today);
  if (open) {
    if (soilingOpen)
      return { kind: 'resolve', type: 'cleaning_due_soon', reason: 'soiling_opened' };
    const cleaned = input.events.some(
      (e) => RESET_EVENTS.includes(e.type) && e.date >= open.detectedOn && e.date <= input.today,
    );
    if (cleaned) return { kind: 'resolve', type: 'cleaning_due_soon', reason: 'cleaning_event' };
    return { kind: 'update', type: 'cleaning_due_soon', severity: 'info' };
  }
  const due =
    today?.daysToCleaning != null &&
    today.daysToCleaning >= 1 &&
    today.daysToCleaning <= DUE_SOON_MAX_DAYS &&
    (today.predictionConfidence === 'medium' || today.predictionConfidence === 'high');
  // Con una caída brusca activa la tendencia no es de suciedad (specs/PREGUNTAS.md #103).
  if (!today || !due || soilingOpen || suddenDropActive) return null;
  return {
    kind: 'open',
    type: 'cleaning_due_soon',
    severity: 'info',
    trigger: { dates: [today.date], deviation_pct: [today.deviationPct] },
  };
}

/** Acciones de las reglas diarias para una planta y una fecha. */
export function evaluateDailyAlerts(input: DailyAlertInput): AlertAction[] {
  const valid = validDays(input);
  const actions: AlertAction[] = [];

  const drop = evaluateSuddenDrop(input, valid);
  if (drop) actions.push(drop);
  const suddenDropActive = drop !== null && drop.kind !== 'resolve';

  const soiling = evaluateSoiling(input, valid, suddenDropActive);
  if (soiling) actions.push(soiling);
  const soilingOpen = soiling !== null && soiling.kind !== 'resolve';

  const dueSoon = evaluateCleaningDueSoon(input, soilingOpen, suddenDropActive);
  if (dueSoon) actions.push(dueSoon);
  return actions;
}

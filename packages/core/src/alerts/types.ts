import type { Confidence } from '../performance/soiling.js';

// Entradas y salidas de las reglas de alertas (specs/06). Las reglas son puras: reciben métricas
// diarias y eventos ya convertidos a fechas locales, y devuelven acciones que aplica el job
// alerts.evaluate.

export type AlertType = 'offline' | 'sudden_drop' | 'soiling' | 'cleaning_due_soon';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertThresholds = {
  soiling_deviation_pct: number;
  soiling_consecutive_days: number;
  sudden_drop_pct: number;
  offline_hours: number;
  rain_reset_mm: number;
  neighbor_radius_km: number;
  neighbor_min_count: number;
  zone_event_pct: number;
};

/** Una fila de plant_daily_metrics, lo que usan las reglas. */
export type AlertDay = {
  /** Fecha local YYYY-MM-DD. */
  date: string;
  isValidDay: boolean;
  deviationPct: number | null;
  neighborIndex: number | null;
  rainMm: number | null;
  zoneEvent: boolean;
  soilingSlopePctPerDay: number | null;
  daysToCleaning: number | null;
  predictionConfidence: Confidence | null;
};

/** Evento de planta con su fecha local. */
export type AlertPlantEvent = { type: string; date: string };

/** Alerta abierta (open o acknowledged) de la planta. */
export type OpenAlert = {
  severity: AlertSeverity;
  /** Fecha local en que se detectó. */
  detectedOn: string;
  /** Ya se marcó que un lavado no recuperó el rendimiento (solo soiling). */
  cleaningDidNotRecover?: boolean;
};

/** Días que dispararon la regla, para la evidencia (`trigger` de specs/06 §3). */
export type AlertTrigger = { dates: string[]; deviation_pct: (number | null)[] };

export type AlertAction =
  | { kind: 'open'; type: AlertType; severity: AlertSeverity; trigger: AlertTrigger }
  | {
      kind: 'update';
      type: AlertType;
      severity: AlertSeverity;
      /** Presente si la condición se volvió a cumplir hoy. */
      trigger?: AlertTrigger;
      /** soiling: hubo lavado y la desviación siguió alta (specs/06 §2). */
      cleaningDidNotRecover?: boolean;
      /** Volver a generar la explicación IA. */
      reexplain?: boolean;
    }
  | { kind: 'resolve'; type: AlertType; reason: AlertResolveReason };

export type AlertResolveReason =
  'recovered' | 'cleaning_recovered' | 'cleaning_event' | 'soiling_opened' | 'readings_resumed';

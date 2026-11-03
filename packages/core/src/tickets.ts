// Tiempos de los tickets de mantenimiento (specs/06 §5, specs/PREGUNTAS.md #204). Funciones puras.

const MINUTE_MS = 60_000;

export type TicketTimes = { createdAt: Date; startedAt: Date | null; resolvedAt: Date | null };

export type TicketDurations = {
  /** De creado a iniciado: cuánto esperó antes de que alguien empezara. */
  waitMinutes: number | null;
  /** De iniciado a resuelto ("Iniciar" → "Resolver"): el tiempo de trabajo. */
  workMinutes: number | null;
  /** De creado a resuelto. */
  totalMinutes: number | null;
  /** En curso: minutos desde que se inició hasta `now`. */
  elapsedMinutes: number | null;
};

const minutes = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS));

export function ticketDurations(t: TicketTimes, now: Date): TicketDurations {
  return {
    waitMinutes: t.startedAt ? minutes(t.createdAt, t.startedAt) : null,
    workMinutes: t.startedAt && t.resolvedAt ? minutes(t.startedAt, t.resolvedAt) : null,
    totalMinutes: t.resolvedAt ? minutes(t.createdAt, t.resolvedAt) : null,
    elapsedMinutes: t.startedAt && !t.resolvedAt ? minutes(t.startedAt, now) : null,
  };
}

export type DurationStats = {
  count: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
};

/** Promedio y mediana de duraciones; ignora las que no se registraron (null). */
export function durationStats(values: (number | null)[]): DurationStats {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, avgMinutes: null, medianMinutes: null };
  const mid = Math.floor(v.length / 2);
  const median =
    v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return {
    count: v.length,
    avgMinutes: Math.round(v.reduce((s, x) => s + x, 0) / v.length),
    medianMinutes: Math.round(median),
  };
}

/** "45 min", "2 h 15 min", "3 d 4 h": legible para el operador. */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return hours ? `${days} d ${hours} h` : `${days} d`;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

// Fechas en la zona horaria de la empresa (se guarda en UTC y se calcula en hora local).

const HOUR_MS = 3_600_000;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** Desfase de la zona respecto a UTC en esa fecha, en ms (por ejemplo −7 h en Mazatlán). */
function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Hora local (0–23) en la zona. */
export function localHour(date: Date, timeZone: string): number {
  return partsIn(date, timeZone).hour;
}

/** Fecha local YYYY-MM-DD en la zona. */
export function localDate(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Instante UTC del inicio (00:00 local) del día YYYY-MM-DD en la zona. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  // Dos pasadas para cubrir cambios de horario cerca de la medianoche.
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

/** Inicio de la hora UTC que contiene `date`. */
export function floorToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

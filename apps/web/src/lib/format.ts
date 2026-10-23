// Formato es-MX (specs/09): números con separador de miles y fechas en la zona de la empresa.

const nf = (digits: number) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Energía: kWh hasta 10 MWh, después MWh. */
export function formatEnergy(kwh: number): { value: string; unit: 'kWh' | 'MWh' } {
  return kwh >= 10_000
    ? { value: nf(1).format(kwh / 1000), unit: 'MWh' }
    : { value: nf(kwh >= 100 ? 0 : 1).format(kwh), unit: 'kWh' };
}

export const formatNumber = (n: number, digits = 0) => nf(digits).format(n);

/** Fracción (0.856) como porcentaje (85.6 %). */
export const formatPct = (fraction: number, digits = 1) => `${nf(digits).format(fraction * 100)} %`;

export function formatDate(
  day: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', ...opts }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export function formatDateTime(iso: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Desfase (ms) de la zona `timeZone` respecto a UTC en el instante `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - utcMs;
}

/**
 * Valor de un <input type="datetime-local"> ("2026-10-23T09:30") leído como hora de la zona de la
 * empresa, no del navegador, a ISO UTC.
 */
export function zonedLocalToIso(value: string, timeZone: string): string {
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0] = value.split(/[-T:]/).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Dos pasadas para los cambios de horario.
  let utc = naive - zoneOffsetMs(naive, timeZone);
  utc = naive - zoneOffsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}

/** Suma días a una fecha YYYY-MM-DD. */
export function addDaysIso(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

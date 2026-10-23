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

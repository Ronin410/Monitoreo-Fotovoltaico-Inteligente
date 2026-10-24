import { addDays, localDate, startOfLocalDay } from '../time.js';

// Periodos (YYYY-MM) del reporte mensual y qué plantas entran en él (specs/08 §1).

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Primer y último día (YYYY-MM-DD) de un periodo YYYY-MM. */
export function periodDays(period: string): { first: string; last: string } {
  const first = `${period}-01`;
  const next = addDays(first, 32).slice(0, 7);
  return { first, last: addDays(`${next}-01`, -1) };
}

/** Periodo desplazado `months` meses. */
export function shiftPeriod(period: string, months: number): string {
  const [y = 0, m = 1] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

/** Mes en curso en la zona de la empresa. */
export function currentPeriod(now: Date, timeZone: string): string {
  return localDate(now, timeZone).slice(0, 7);
}

/** Solo hay reporte de meses ya cerrados. */
export function isClosedPeriod(period: string, now: Date, timeZone: string): boolean {
  return PERIOD_PATTERN.test(period) && period < currentPeriod(now, timeZone);
}

export type PlantForPeriod = {
  status: string;
  commissioningDate: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

/**
 * La planta estuvo activa al menos un día del periodo: dada de alta antes de que terminara, no
 * eliminada antes de que empezara y no dada de baja.
 */
export function plantInPeriod(plant: PlantForPeriod, period: string, timeZone: string): boolean {
  const { first, last } = periodDays(period);
  if (plant.status === 'decommissioned') return false;
  if (plant.deletedAt && plant.deletedAt < startOfLocalDay(first, timeZone)) return false;
  return localDate(plant.commissioningDate ?? plant.createdAt, timeZone) <= last;
}

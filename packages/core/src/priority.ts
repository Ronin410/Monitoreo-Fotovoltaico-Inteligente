import type { InstallationType } from './types.js';

// Prioridad por defecto del ticket que nace de una alerta (specs/06 §5). La severidad manda; una
// falla en un negocio o en una planta grande sube un nivel, porque cada día cuesta más dinero.

export type AlertSeverityLevel = 'info' | 'warning' | 'critical';
export type TicketPriorityLevel = 'low' | 'normal' | 'high';

/** Desde esta capacidad una planta cuenta como grande aunque sea residencial. */
export const LARGE_PLANT_KWP = 30;

const BY_SEVERITY: Record<AlertSeverityLevel, TicketPriorityLevel> = {
  critical: 'high',
  warning: 'normal',
  info: 'low',
};
const RAISE: Record<TicketPriorityLevel, TicketPriorityLevel> = {
  low: 'normal',
  normal: 'high',
  high: 'high',
};

/** ¿La planta pesa más que una casa típica? Negocio, industria o ≥ 30 kWp. */
export function isHighImpactPlant(plant: {
  installationType: InstallationType;
  capacityKwp: number;
}): boolean {
  return plant.installationType !== 'residential' || plant.capacityKwp >= LARGE_PLANT_KWP;
}

export function ticketPriorityFor(
  severity: AlertSeverityLevel,
  plant: { installationType: InstallationType; capacityKwp: number },
): TicketPriorityLevel {
  const base = BY_SEVERITY[severity];
  return isHighImpactPlant(plant) ? RAISE[base] : base;
}

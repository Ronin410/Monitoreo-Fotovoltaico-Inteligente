// Pérdida estimada por día de una alerta (specs/09 §Alertas: "pérdida estimada en kWh y MXN por
// día"). Con caída brusca o suciedad se pierde la diferencia entre el rendimiento normal y el real;
// sin datos, se pierde todo lo que la planta debió producir.

export type LossDay = {
  /** Energía esperada corregida por temperatura (kWh). */
  expectedTempKwh: number;
  prTemp: number | null;
  prBaseline: number | null;
  isValidDay: boolean;
};

/** kWh perdidos por día, promedio de los días que sirven; null si ninguno sirve. */
export function estimatedDailyLossKwh(
  kind: 'underperformance' | 'no_production',
  days: LossDay[],
): number | null {
  const usable = days.filter((d) =>
    kind === 'no_production'
      ? d.prBaseline !== null && d.expectedTempKwh > 0
      : d.isValidDay && d.prTemp !== null && d.prBaseline !== null,
  );
  if (usable.length === 0) return null;
  const losses = usable.map((d) =>
    kind === 'no_production'
      ? d.expectedTempKwh * (d.prBaseline as number)
      : Math.max(0, d.expectedTempKwh * ((d.prBaseline as number) - (d.prTemp as number))),
  );
  return losses.reduce((s, v) => s + v, 0) / losses.length;
}

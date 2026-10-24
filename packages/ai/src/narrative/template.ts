import type { ReportFacts } from '@pv/core';

// Plantilla de la narrativa sin IA (specs/08 §3): mismos datos, mismo tono.

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const n1 = (v: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(v);
const money = (v: number) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

export const monthName = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1] ?? period;

export function templateNarrative(facts: ReportFacts, companyName: string): string {
  const month = monthName(facts.period);
  const parts: string[] = [];
  let first = `En ${month}, su sistema generó ${n1(facts.energy_kwh)} kWh de energía limpia`;
  if (facts.energy_change_pct !== null) {
    const change = facts.energy_change_pct;
    first +=
      Math.abs(change) < 1
        ? ', prácticamente lo mismo que el mes anterior'
        : `, ${n1(Math.abs(change))} % ${change > 0 ? 'más' : 'menos'} que el mes anterior`;
  }
  parts.push(`${first}.`);
  if (facts.cloudy_days > 0 || facts.rain_days > 0) {
    const weather = [
      facts.cloudy_days > 0
        ? `${facts.cloudy_days} ${facts.cloudy_days === 1 ? 'día nublado' : 'días nublados'}`
        : null,
      facts.rain_days > 0
        ? `${facts.rain_days} ${facts.rain_days === 1 ? 'día con lluvia' : 'días con lluvia'}`
        : null,
    ].filter(Boolean);
    parts.push(`El clima influyó: hubo ${weather.join(' y ')}.`);
  }
  let savings = `Con su tarifa de $${money(facts.tariff_mxn_per_kwh)} por kWh, esto representa un ahorro estimado de $${money(facts.savings_mxn)} MXN`;
  if (facts.consumption_coverage_pct !== null) {
    savings += ` y cubrió cerca del ${n1(facts.consumption_coverage_pct)} % de su consumo habitual`;
  }
  parts.push(`${savings}.`);
  if (facts.cleanings > 0) {
    parts.push(
      facts.cleanings === 1
        ? 'Durante el mes se realizó una limpieza de los paneles.'
        : `Durante el mes se realizaron ${facts.cleanings} limpiezas de los paneles.`,
    );
  }
  if (facts.alerts_opened > 0 || facts.open_issues.length > 0) {
    parts.push(
      facts.open_issues.length > 0
        ? `Nuestro equipo está atendiendo ${facts.open_issues.length === 1 ? 'un punto pendiente' : 'algunos puntos pendientes'} y su sistema se monitorea todos los días.`
        : 'Detectamos y atendimos oportunamente los avisos del mes; su sistema se monitorea todos los días.',
    );
  } else {
    parts.push('Su sistema funcionó con normalidad y se monitorea todos los días.');
  }
  parts.push(
    `Gracias a su energía solar se evitaron ${n1(facts.co2_avoided_kg)} kg de CO₂. ¡Gracias por confiar en ${companyName}!`,
  );
  return parts.join(' ');
}

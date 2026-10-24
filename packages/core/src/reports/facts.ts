import { z } from 'zod';
import { sunHoursBetween } from '../alerts/offline.js';

// specs/08 §2 — Cifras del reporte mensual de un cliente. Las calcula nuestro código; la narrativa
// solo las interpreta.

/** Un día con nubosidad promedio de al menos este % cuenta como nublado. */
export const CLOUDY_DAY_PCT = 60;
/** Un día con al menos estos mm de lluvia (en alguna planta) cuenta como lluvioso. */
export const RAIN_DAY_MM = 1;

const HOUR_MS = 3_600_000;

export type ReportDay = {
  date: string;
  energyKwh: number;
  expectedTempKwh: number;
  isValidDay: boolean;
  rainMm: number | null;
  cloudCoverAvgPct: number | null;
};

export type ReportPlantInput = {
  name: string;
  capacityKwp: number;
  /** Primer día del mes que cuenta (alta a mitad de mes) y cuántos días del mes se contaron. */
  firstDay: string;
  daysInPeriod: number;
  days: ReportDay[];
  /** Horas con sol del periodo y cuántas tuvieron lecturas. */
  sunHours: number;
  sunHoursWithData: number;
};

export type ReportFactsInput = {
  period: string;
  clientName: string;
  plants: ReportPlantInput[];
  energyPrevMonthKwh: number | null;
  energySameMonthLastYearKwh: number | null;
  tariffMxnPerKwh: number;
  co2KgPerKwh: number;
  avgMonthlyKwh: number | null;
  alertsOpened: number;
  alertsResolved: number;
  cleanings: number;
  openIssues: string[];
};

const dayEnergy = z.object({ date: z.string(), energy_kwh: z.number() });

export const reportFactsSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  client_name: z.string(),
  plants: z.array(
    z.object({
      name: z.string(),
      capacity_kwp: z.number(),
      energy_kwh: z.number(),
      specific_yield: z.number().nullable(),
      pr_temp: z.number().nullable(),
      availability_pct: z.number().nullable(),
      /** Solo si se instaló a mitad de mes. */
      days_counted: z.number().int().optional(),
    }),
  ),
  energy_kwh: z.number(),
  energy_prev_month_kwh: z.number().nullable(),
  energy_change_pct: z.number().nullable(),
  energy_same_month_last_year_kwh: z.number().nullable(),
  savings_mxn: z.number(),
  tariff_mxn_per_kwh: z.number(),
  co2_avoided_kg: z.number(),
  consumption_coverage_pct: z.number().nullable(),
  cloudy_days: z.number().int(),
  rain_days: z.number().int(),
  best_day: dayEnergy.nullable(),
  worst_valid_day: dayEnergy.nullable(),
  alerts_opened: z.number().int(),
  alerts_resolved: z.number().int(),
  cleanings: z.number().int(),
  open_issues: z.array(z.string()),
  daily_energy: z.array(dayEnergy),
});
export type ReportFacts = z.infer<typeof reportFactsSchema>;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Horas con sol en [from, to) y cuántas de ellas tuvieron al menos una lectura. */
export function sunHourCoverage(
  from: Date,
  to: Date,
  lat: number,
  lon: number,
  readings: Date[],
): { sunHours: number; withData: number } {
  const hoursWithData = new Set(readings.map((r) => Math.floor(r.getTime() / HOUR_MS)));
  let sunHours = 0;
  let withData = 0;
  for (let h = Math.floor(from.getTime() / HOUR_MS); h * HOUR_MS < to.getTime(); h++) {
    // Una hora cuenta si el sol estuvo arriba la mitad o más.
    if (sunHoursBetween(new Date(h * HOUR_MS), new Date((h + 1) * HOUR_MS), lat, lon) < 0.5)
      continue;
    sunHours++;
    if (hoursWithData.has(h)) withData++;
  }
  return { sunHours, withData };
}

export function buildReportFacts(input: ReportFactsInput): ReportFacts {
  const byDate = new Map<
    string,
    { energy: number; allValid: boolean; rain: number; clouds: number[] }
  >();
  for (const p of input.plants) {
    for (const d of p.days) {
      const e = byDate.get(d.date) ?? { energy: 0, allValid: true, rain: 0, clouds: [] };
      e.energy += d.energyKwh;
      e.allValid &&= d.isValidDay;
      e.rain = Math.max(e.rain, d.rainMm ?? 0);
      if (d.cloudCoverAvgPct !== null) e.clouds.push(d.cloudCoverAvgPct);
      byDate.set(d.date, e);
    }
  }
  const daily = [...byDate].sort(([a], [b]) => a.localeCompare(b));
  const energy = daily.reduce((s, [, d]) => s + d.energy, 0);
  const valid = daily.filter(([, d]) => d.allValid);
  const pick = (rows: typeof daily, better: (a: number, b: number) => boolean) =>
    rows.reduce<(typeof daily)[number] | null>(
      (best, row) => (!best || better(row[1].energy, best[1].energy) ? row : best),
      null,
    );
  const best = pick(daily, (a, b) => a > b);
  const worst = pick(valid, (a, b) => a < b);
  const prev = input.energyPrevMonthKwh;

  return {
    period: input.period,
    client_name: input.clientName,
    plants: input.plants.map((p) => {
      const e = p.days.reduce((s, d) => s + d.energyKwh, 0);
      const v = p.days.filter((d) => d.isValidDay);
      const expected = v.reduce((s, d) => s + d.expectedTempKwh, 0);
      return {
        name: p.name,
        capacity_kwp: p.capacityKwp,
        energy_kwh: r1(e),
        specific_yield: p.days.length && p.capacityKwp > 0 ? r1(e / p.capacityKwp) : null,
        pr_temp: expected > 0 ? r3(v.reduce((s, d) => s + d.energyKwh, 0) / expected) : null,
        availability_pct: p.sunHours > 0 ? r1((p.sunHoursWithData / p.sunHours) * 100) : null,
        ...(p.firstDay > `${input.period}-01` && { days_counted: p.daysInPeriod }),
      };
    }),
    energy_kwh: r1(energy),
    energy_prev_month_kwh: prev === null ? null : r1(prev),
    energy_change_pct: prev !== null && prev > 0 ? r1(((energy - prev) / prev) * 100) : null,
    energy_same_month_last_year_kwh:
      input.energySameMonthLastYearKwh === null ? null : r1(input.energySameMonthLastYearKwh),
    savings_mxn: r2(energy * input.tariffMxnPerKwh),
    tariff_mxn_per_kwh: input.tariffMxnPerKwh,
    co2_avoided_kg: r1(energy * input.co2KgPerKwh),
    consumption_coverage_pct:
      input.avgMonthlyKwh !== null && input.avgMonthlyKwh > 0
        ? r1((energy / input.avgMonthlyKwh) * 100)
        : null,
    cloudy_days: daily.filter(
      ([, d]) =>
        d.clouds.length > 0 &&
        d.clouds.reduce((s, c) => s + c, 0) / d.clouds.length >= CLOUDY_DAY_PCT,
    ).length,
    rain_days: daily.filter(([, d]) => d.rain >= RAIN_DAY_MM).length,
    best_day: best ? { date: best[0], energy_kwh: r1(best[1].energy) } : null,
    worst_valid_day: worst ? { date: worst[0], energy_kwh: r1(worst[1].energy) } : null,
    alerts_opened: input.alertsOpened,
    alerts_resolved: input.alertsResolved,
    cleanings: input.cleanings,
    open_issues: input.openIssues,
    daily_energy: daily.map(([date, d]) => ({ date, energy_kwh: r1(d.energy) })),
  };
}

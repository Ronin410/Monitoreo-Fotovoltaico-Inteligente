import { describe, expect, it } from 'vitest';
import { buildReportFacts, reportFactsSchema, sunHourCoverage, type ReportDay } from './facts.js';

const day = (date: string, energyKwh: number, over: Partial<ReportDay> = {}): ReportDay => ({
  date,
  energyKwh,
  expectedTempKwh: energyKwh / 0.85,
  isValidDay: true,
  rainMm: 0,
  cloudCoverAvgPct: 10,
  ...over,
});

const base = {
  period: '2026-09',
  clientName: 'Abarrotes El Sol',
  energySameMonthLastYearKwh: null,
  tariffMxnPerKwh: 3.5,
  co2KgPerKwh: 0.438,
  alertsOpened: 1,
  alertsResolved: 1,
  cleanings: 1,
  openIssues: [],
};

describe('cifras del reporte mensual (specs/08 §2)', () => {
  it('cliente con dos plantas: totales, ahorro, CO₂, cobertura, clima y mejores días', () => {
    const facts = buildReportFacts({
      ...base,
      energyPrevMonthKwh: 100,
      avgMonthlyKwh: 120,
      plants: [
        {
          name: 'Casa',
          capacityKwp: 5,
          firstDay: '2026-09-01',
          daysInPeriod: 30,
          days: [
            day('2026-09-01', 20),
            day('2026-09-02', 10, { isValidDay: false, cloudCoverAvgPct: 90, rainMm: 6 }),
            day('2026-09-03', 25),
          ],
          sunHours: 360,
          sunHoursWithData: 357,
        },
        {
          name: 'Bodega',
          capacityKwp: 10,
          firstDay: '2026-09-01',
          daysInPeriod: 30,
          days: [
            day('2026-09-01', 40),
            day('2026-09-02', 15, { cloudCoverAvgPct: 70 }),
            day('2026-09-03', 30),
          ],
          sunHours: 360,
          sunHoursWithData: 360,
        },
      ],
    });
    expect(reportFactsSchema.parse(facts)).toEqual(facts);
    expect(facts).toMatchObject({
      energy_kwh: 140,
      energy_prev_month_kwh: 100,
      energy_change_pct: 40,
      savings_mxn: 490,
      co2_avoided_kg: 61.3,
      consumption_coverage_pct: 116.7,
      // El 2: nubosidad promedio (90 + 70) / 2 = 80 % y 6 mm en una planta.
      cloudy_days: 1,
      rain_days: 1,
      best_day: { date: '2026-09-01', energy_kwh: 60 },
      // El 2 no cuenta: una planta tuvo día no válido.
      worst_valid_day: { date: '2026-09-03', energy_kwh: 55 },
      daily_energy: [
        { date: '2026-09-01', energy_kwh: 60 },
        { date: '2026-09-02', energy_kwh: 25 },
        { date: '2026-09-03', energy_kwh: 55 },
      ],
    });
    expect(facts.plants[0]).toEqual({
      name: 'Casa',
      capacity_kwp: 5,
      energy_kwh: 55,
      specific_yield: 11,
      // Solo días válidos: (20 + 25) / (45 / 0.85).
      pr_temp: 0.85,
      availability_pct: 99.2,
    });
  });

  it('planta instalada a mitad de mes indica los días contados; sin mes anterior no hay cambio', () => {
    const facts = buildReportFacts({
      ...base,
      energyPrevMonthKwh: null,
      avgMonthlyKwh: null,
      plants: [
        {
          name: 'Nueva',
          capacityKwp: 4,
          firstDay: '2026-09-16',
          daysInPeriod: 15,
          days: [day('2026-09-16', 12)],
          sunHours: 180,
          sunHoursWithData: 180,
        },
      ],
    });
    expect(facts.plants[0]?.days_counted).toBe(15);
    expect(facts).toMatchObject({ energy_change_pct: null, consumption_coverage_pct: null });
  });

  it('mes sin datos: ceros y nulos, sin mejores días', () => {
    const facts = buildReportFacts({
      ...base,
      energyPrevMonthKwh: 0,
      avgMonthlyKwh: 100,
      plants: [
        {
          name: 'X',
          capacityKwp: 3,
          firstDay: '2026-09-01',
          daysInPeriod: 30,
          days: [],
          sunHours: 0,
          sunHoursWithData: 0,
        },
      ],
    });
    expect(facts).toMatchObject({
      energy_kwh: 0,
      energy_change_pct: null,
      best_day: null,
      worst_valid_day: null,
      daily_energy: [],
      consumption_coverage_pct: 0,
    });
    expect(facts.plants[0]).toMatchObject({
      specific_yield: null,
      pr_temp: null,
      availability_pct: null,
    });
  });

  it('disponibilidad: horas con sol con al menos una lectura', () => {
    // Un día en Culiacán (UTC−7): ~12 horas de sol.
    const from = new Date('2026-09-15T07:00:00Z');
    const to = new Date('2026-09-16T07:00:00Z');
    const all = sunHourCoverage(from, to, 24.8, -107.39, []);
    expect(all.sunHours).toBeGreaterThanOrEqual(11);
    expect(all.sunHours).toBeLessThanOrEqual(13);
    expect(all.withData).toBe(0);
    // Lecturas cada 15 min de 8:00 a 18:00 locales (15:00–01:00 UTC) y una de noche que no cuenta.
    const readings = [];
    for (
      let t = Date.parse('2026-09-15T15:00:00Z');
      t < Date.parse('2026-09-16T01:00:00Z');
      t += 900_000
    )
      readings.push(new Date(t));
    readings.push(new Date('2026-09-15T10:00:00Z'));
    const some = sunHourCoverage(from, to, 24.8, -107.39, readings);
    expect(some.withData).toBe(10);
  });
});

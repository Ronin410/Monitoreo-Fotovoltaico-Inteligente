import { describe, expect, it } from 'vitest';
import { normalizeReadings } from '../telemetry.js';
import { computeBaseline, deviationPct, percentile, type BaselineDay } from './baseline.js';
import { computeDay, type DayHourInput } from './daily.js';
import { computeHour, temperatureFactor } from './hourly.js';
import { haversineKm, neighborIndex, type NeighborCandidate } from './neighbors.js';
import {
  confidenceOf,
  daysToCleaning,
  lastResetEvent,
  linearRegression,
  predictSoiling,
} from './soiling.js';
import { dailyStatus } from './status.js';

// specs/05 §10. Tolerancia ±0.0001.
const TOL = 4; // decimales para toBeCloseTo: |a − b| < 0.5 × 10⁻⁴ (más estricto que ±0.0001)
const near = (actual: number | null, expected: number, tol = 0.0001) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
};

const PANEL = { capacityKwp: 5, noctC: 45, gammaPctPerC: -0.4 };
const THRESHOLDS = { min_valid_irradiation_kwh_m2: 2.0, min_data_completeness_pct: 80 };

describe('Caso A — una hora en Culiacán (5 kWp, NOCT 45, γ −0.40)', () => {
  const h = computeHour({ poaWm2: 900, tempAmbC: 38, energyKwh: 3.2, intervals: 4 }, PANEL);

  it('T_cell = 66.125 °C, F_temp = 0.8355', () => {
    near(h.tCellC, 66.125);
    near(h.fTemp, 0.8355);
  });

  it('E_stc = 4.5 kWh, E_exp = 3.75975 kWh', () => {
    near(h.expectedStcKwh, 4.5);
    near(h.expectedTempKwh, 3.75975);
  });

  it('PR = 0.7111 y PR_temp = 0.8511: corregida, la planta está bien', () => {
    const day = computeDay(
      [{ poaWm2: 900, tempAmbC: 38, energyKwh: 3.2, intervals: 4 }],
      PANEL,
      THRESHOLDS,
      true,
    );
    near(day.pr, 0.7111);
    near(day.prTemp, 0.8511);
  });
});

describe('Caso B — día de tres horas', () => {
  const hours: DayHourInput[] = [
    { poaWm2: 400, tempAmbC: 30, energyKwh: 1.6, intervals: 4 },
    { poaWm2: 900, tempAmbC: 38, energyKwh: 3.2, intervals: 4 },
    { poaWm2: 600, tempAmbC: 36, energyKwh: 2.3, intervals: 4 },
  ];
  const day = computeDay(hours, PANEL, THRESHOLDS, true);

  it('cada hora coincide con la tabla', () => {
    const [h1, h2, h3] = hours.map((h) => computeHour(h, PANEL));
    near(h1!.tCellC, 42.5);
    near(h1!.fTemp, 0.93);
    near(h1!.expectedTempKwh, 1.86);
    near(h2!.fTemp, 0.8355);
    near(h3!.tCellC, 54.75);
    near(h3!.fTemp, 0.881);
    near(h3!.expectedTempKwh, 2.643);
  });

  it('Σ E_real = 7.1; Σ E_stc = 9.5; Σ E_exp = 8.26275', () => {
    near(day.energyKwh, 7.1);
    near(day.expectedStcKwh, 9.5);
    near(day.expectedTempKwh, 8.26275);
  });

  it('PR = 0.7474 y PR_temp = 0.8593', () => {
    near(day.pr, 0.7474);
    near(day.prTemp, 0.8593);
  });

  it('con línea base 0.95, deviation_pct = 9.55', () => {
    // El spec da 2 decimales: 100 × (0.95 − 0.85928…) / 0.95 = 9.549…
    expect(deviationPct(0.95, day.prTemp!)).toBeCloseTo(9.55, 2);
  });
});

describe('Caso C — predicción', () => {
  it('r_hoy = 94 %, pendiente −0.3 %/día, umbral 88 → 20 días', () => {
    expect(daysToCleaning(94, -0.3, 88)).toBe(20);
  });

  it('no suma un día por ruido de punto flotante', () => {
    expect(daysToCleaning(94 + 1e-12, -0.3, 88)).toBe(20);
  });

  it('la misma predicción a partir de una recta ajustada', () => {
    // Puntos exactamente sobre r = 97 − 0.3·d, d = 0..10 (hoy = 10 → r_hoy = 94).
    const points = Array.from({ length: 11 }, (_, d) => ({ day: d, rPct: 97 - 0.3 * d }));
    const p = predictSoiling(points, 10, 12);
    near(p.slopePctPerDay, -0.3);
    near(p.rTodayPct, 94);
    expect(p.daysToCleaning).toBe(20);
    expect(p.confidence).toBe('medium'); // R² = 1 pero n = 11 < 14
  });
});

describe('otros casos de specs/05 §10', () => {
  it('una hora sin cubrir se excluye del PR (numerador y denominador)', () => {
    const full = computeDay(
      [
        { poaWm2: 800, tempAmbC: 30, energyKwh: 3.4, intervals: 4 },
        { poaWm2: 800, tempAmbC: 30, energyKwh: 3.4, intervals: 4 },
      ],
      PANEL,
      THRESHOLDS,
      true,
    );
    const missing = computeDay(
      [
        { poaWm2: 800, tempAmbC: 30, energyKwh: 3.4, intervals: 4 },
        { poaWm2: 800, tempAmbC: 30, energyKwh: 0.8, intervals: 1 }, // solo 1 de 4 intervalos
      ],
      PANEL,
      THRESHOLDS,
      true,
    );
    near(missing.prTemp, full.prTemp!);
    near(missing.pr, full.pr!);
    // Pero la energía del día sí suma todo (para reportes).
    near(missing.energyKwh, 4.2);
    near(missing.dataCompletenessPct, 50);
  });

  it('una hora con 3 de 4 intervalos sí está cubierta; sin clima no lo está', () => {
    expect(
      computeHour({ poaWm2: 500, tempAmbC: 30, energyKwh: 1, intervals: 3 }, PANEL).covered,
    ).toBe(true);
    expect(
      computeHour({ poaWm2: null, tempAmbC: null, energyKwh: 1, intervals: 4 }, PANEL).covered,
    ).toBe(false);
  });

  it('la completitud se pondera por irradiancia', () => {
    // Pierde la hora de 900 W/m²: completitud = 1 − 4.5 / 9.5.
    const day = computeDay(
      [
        { poaWm2: 400, tempAmbC: 30, energyKwh: 1.6, intervals: 4 },
        { poaWm2: 900, tempAmbC: 38, energyKwh: 0, intervals: 0 },
        { poaWm2: 600, tempAmbC: 36, energyKwh: 2.3, intervals: 4 },
      ],
      PANEL,
      THRESHOLDS,
      true,
    );
    near(day.dataCompletenessPct, (100 * 5) / 9.5);
  });

  it('el reinicio del contador a medianoche se normaliza sin energía negativa', () => {
    const intervals = normalizeReadings(
      [{ ts: new Date('2026-10-21T07:00:00Z'), powerKw: 0.2, energyTodayKwh: 0.05 }],
      { ts: new Date('2026-10-21T06:45:00Z'), energyTodayKwh: 38.4 },
    );
    expect(intervals[0]?.energyKwh).toBe(0.05);
  });

  it('un día con 1.5 kWh/m² es inválido (low_irradiation)', () => {
    const day = computeDay(
      [
        { poaWm2: 750, tempAmbC: 28, energyKwh: 3, intervals: 4 },
        { poaWm2: 750, tempAmbC: 28, energyKwh: 3, intervals: 4 },
      ],
      PANEL,
      THRESHOLDS,
      true,
    );
    near(day.irradiationPoaKwhM2, 1.5);
    expect(day).toMatchObject({ isValidDay: false, invalidReason: 'low_irradiation' });
  });

  it('en el límite exacto (2.0 kWh/m² y 80 % de completitud) el día es válido', () => {
    // 4 horas a 500 W/m² = 2.0 kWh/m²; con una quinta hora sin datos la completitud queda en 80 %.
    const hours = Array.from({ length: 4 }, () => ({
      poaWm2: 500,
      tempAmbC: 25,
      energyKwh: 2,
      intervals: 4,
    }));
    const day = computeDay(hours, PANEL, THRESHOLDS, true);
    near(day.irradiationPoaKwhM2, 2.0);
    expect(day).toMatchObject({ isValidDay: true, invalidReason: null });

    const five = [
      ...Array.from({ length: 4 }, () => ({
        poaWm2: 500,
        tempAmbC: 25,
        energyKwh: 2,
        intervals: 4,
      })),
      { poaWm2: 500, tempAmbC: 25, energyKwh: 0, intervals: 0 },
    ];
    const edge = computeDay(five, PANEL, THRESHOLDS, true);
    near(edge.dataCompletenessPct, 80);
    expect(edge).toMatchObject({ isValidDay: true, invalidReason: null });
  });

  it('motivos de invalidez: sin clima, sin telemetría, datos incompletos', () => {
    expect(
      computeDay(
        [{ poaWm2: null, tempAmbC: null, energyKwh: 2, intervals: 4 }],
        PANEL,
        THRESHOLDS,
        true,
      ).invalidReason,
    ).toBe('no_weather');
    const sunny = Array.from({ length: 6 }, () => ({
      poaWm2: 800,
      tempAmbC: 30,
      energyKwh: 0,
      intervals: 0,
    }));
    expect(computeDay(sunny, PANEL, THRESHOLDS, false).invalidReason).toBe('offline');
    const partial = sunny.map((h, i) => (i < 3 ? { ...h, energyKwh: 3, intervals: 4 } : h));
    expect(computeDay(partial, PANEL, THRESHOLDS, true).invalidReason).toBe('incomplete_data');
    const ok = sunny.map((h) => ({ ...h, energyKwh: 3, intervals: 4 }));
    expect(computeDay(ok, PANEL, THRESHOLDS, true)).toMatchObject({
      isValidDay: true,
      invalidReason: null,
    });
  });

  it('clamp de F_temp entre 0.5 y 1.10', () => {
    expect(temperatureFactor(200, -0.4)).toBe(0.5);
    expect(temperatureFactor(-30, -0.4)).toBe(1.1);
    expect(temperatureFactor(25, -0.4)).toBe(1);
  });

  it('con menos de 7 puntos no hay predicción', () => {
    const points = Array.from({ length: 6 }, (_, d) => ({ day: d, rPct: 99 - d }));
    expect(predictSoiling(points, 5, 12)).toEqual({
      slopePctPerDay: null,
      r2: null,
      rTodayPct: null,
      daysToCleaning: null,
      confidence: null,
      points: 6,
    });
  });

  describe('vecinas', () => {
    const plant = (
      id: string,
      lat: number | null,
      lon: number | null,
      prTemp: number,
      prBaseline = 0.9,
      postalCode = '80000',
      isValidDay = true,
    ): NeighborCandidate => ({ plantId: id, lat, lon, postalCode, prTemp, prBaseline, isValidDay });

    it('usa las vecinas dentro del radio y normaliza cada una contra su línea base', () => {
      const target = plant('t', 24.8, -107.39, 0.774); // r = 0.86
      const neighbors = [
        plant('a', 24.81, -107.39, 0.9, 0.9), // r = 1.0, ~1.1 km
        plant('b', 24.8, -107.4, 0.8, 0.8), // r = 1.0
        plant('c', 24.79, -107.38, 0.855, 0.95), // r = 0.9
        plant('lejos', 25.5, -108, 0.1), // fuera del radio
      ];
      const r = neighborIndex(target, neighbors, { radiusKm: 5, minCount: 3 });
      expect(r).toMatchObject({ count: 3, method: 'radius' });
      near(r.index, 0.86 / 1.0);
    });

    it('vecinas insuficientes → código postal → null', () => {
      const target = plant('t', 24.8, -107.39, 0.8, 0.9, '80020');
      const sameCp = [
        plant('a', 25.5, -108, 0.9, 0.9, '80020'),
        plant('b', 25.6, -108, 0.9, 0.9, '80020'),
        plant('c', 25.7, -108, 0.9, 0.9, '80020'),
      ];
      const byCp = neighborIndex(target, sameCp, { radiusKm: 5, minCount: 3 });
      expect(byCp).toMatchObject({ count: 3, method: 'postal_code' });
      near(byCp.index, 0.8 / 0.9);

      const none = neighborIndex(target, sameCp.slice(0, 2), { radiusKm: 5, minCount: 3 });
      expect(none).toEqual({ index: null, count: 0, method: null });
    });

    it('excluye la propia planta y las vecinas con día inválido', () => {
      const target = plant('t', 24.8, -107.39, 0.8);
      const r = neighborIndex(
        target,
        [
          target,
          plant('a', 24.8, -107.39, 0.9),
          plant('b', 24.8, -107.39, 0.9),
          plant('x', 24.8, -107.39, 0.9, 0.9, '80000', false),
        ],
        { radiusKm: 5, minCount: 3 },
      );
      expect(r.index).toBeNull();
    });

    it('haversine: Culiacán centro – Las Quintas ≈ 1.4 km', () => {
      expect(haversineKm(24.8069, -107.3938, 24.7957, -107.4012)).toBeCloseTo(1.45, 1);
    });
  });
});

describe('línea base (§4)', () => {
  const days = (n: number, start = '2026-07-01', over: Partial<BaselineDay> = {}): BaselineDay[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      prTemp: 0.8 + (i % 10) * 0.01,
      isValidDay: true,
      suddenDropActive: false,
      ...over,
    }));

  it('propia: P80 de los días válidos de los 90 días anteriores', () => {
    const history = days(20, '2026-10-01');
    const b = computeBaseline('2026-10-21', history);
    expect(b.source).toBe('own');
    near(
      b.value,
      percentile(
        history.map((d) => d.prTemp!),
        80,
      ),
    );
  });

  it('no incluye el día evaluado, días fuera de la ventana, inválidos ni con sudden_drop', () => {
    const valid = days(10, '2026-10-01');
    const noise = [
      ...days(5, '2026-06-01', { prTemp: 0.1 }), // fuera de los 90 días
      ...days(3, '2026-10-11', { prTemp: 0.1, isValidDay: false }),
      ...days(3, '2026-10-14', { prTemp: 0.1, suddenDropActive: true }),
      { date: '2026-10-21', prTemp: 0.1, isValidDay: true, suddenDropActive: false },
    ];
    const b = computeBaseline('2026-10-21', [...valid, ...noise]);
    expect(b.source).toBe('own');
    near(
      b.value,
      percentile(
        valid.map((d) => d.prTemp!),
        80,
      ),
    );
  });

  it('provisional con menos de 10 días: mediana de las vecinas; si no, 0.85', () => {
    expect(computeBaseline('2026-10-21', days(9, '2026-10-10'), [0.8, 0.9, 0.86])).toEqual({
      value: 0.86,
      source: 'neighbors',
    });
    expect(computeBaseline('2026-10-21', [])).toEqual({ value: 0.85, source: 'default' });
  });

  it('percentil con interpolación lineal', () => {
    expect(percentile([1, 2, 3, 4, 5], 80)).toBeCloseTo(4.2, TOL);
    expect(percentile([7], 80)).toBe(7);
  });
});

describe('tendencia de suciedad (§7)', () => {
  it('reinicio: el evento cleaning, rain_cleaning o repair más reciente', () => {
    const events = [
      { type: 'cleaning', occurredAt: new Date('2026-09-01') },
      { type: 'note', occurredAt: new Date('2026-10-10') },
      { type: 'rain_cleaning', occurredAt: new Date('2026-09-20') },
      { type: 'repair', occurredAt: new Date('2026-10-25') }, // futuro respecto a la fecha
    ];
    expect(lastResetEvent(events, new Date('2026-10-21'))?.type).toBe('rain_cleaning');
    expect(lastResetEvent([], new Date())).toBeNull();
  });

  it('regresión lineal y R²', () => {
    const fit = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    near(fit.slope, 2);
    near(fit.intercept, 1);
    near(fit.r2, 1);
  });

  it('ya bajo el umbral → 0 días; sin tendencia → null; más de 120 días → null', () => {
    expect(daysToCleaning(87, -0.3, 88)).toBe(0);
    expect(daysToCleaning(95, -0.01, 88)).toBeNull();
    expect(daysToCleaning(95, 0.2, 88)).toBeNull();
    expect(daysToCleaning(99, -0.06, 88)).toBeNull(); // 184 días
  });

  it('confianza', () => {
    expect(confidenceOf(0.8, 14)).toBe('high');
    expect(confidenceOf(0.8, 13)).toBe('medium');
    expect(confidenceOf(0.5, 30)).toBe('medium');
    expect(confidenceOf(0.2, 30)).toBe('low');
  });
});

describe('estado diario (§8)', () => {
  const base = {
    hasWeather: true,
    hasTelemetry: true,
    openAlertSeverities: [] as ('info' | 'warning' | 'critical')[],
    deviationPct: 3,
    daysToCleaning: null,
    soilingDeviationPct: 12,
  };

  it('en orden de prioridad', () => {
    expect(dailyStatus({ ...base, hasWeather: false, hasTelemetry: false })).toBe('no_data');
    expect(dailyStatus({ ...base, hasTelemetry: false, openAlertSeverities: ['critical'] })).toBe(
      'offline',
    );
    expect(dailyStatus({ ...base, openAlertSeverities: ['critical', 'warning'] })).toBe('critical');
    expect(dailyStatus({ ...base, deviationPct: 12.5 })).toBe('warning');
    expect(dailyStatus({ ...base, daysToCleaning: 7 })).toBe('warning');
    expect(dailyStatus({ ...base, openAlertSeverities: ['warning'] })).toBe('warning');
    expect(dailyStatus({ ...base, openAlertSeverities: ['info'], daysToCleaning: 8 })).toBe('ok');
    expect(dailyStatus(base)).toBe('ok');
  });
});

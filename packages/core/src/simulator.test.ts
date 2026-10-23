import { describe, expect, it } from 'vitest';
import type { SimulationScenario } from './simulation.js';
import {
  rainResetTimes,
  simulateReadings,
  simulatedPowerKw,
  type SimWeatherHour,
  type SimulatedPlant,
} from './simulator.js';
import { startOfLocalDay } from './time.js';

const TZ = 'America/Mazatlan';
const HOUR = 3_600_000;

function plant(
  scenarios: SimulationScenario[] = [],
  over: Partial<SimulatedPlant['profile']> = {},
): SimulatedPlant {
  return {
    id: 'planta-sim',
    capacityKwp: 5,
    noctC: 45,
    gammaPctPerC: -0.4,
    timezone: TZ,
    profile: {
      seed: 1234,
      system_efficiency: 0.89,
      ac_limit_kw: 9,
      noise_pct: 0,
      scenarios,
      ...over,
    },
  };
}

/**
 * Clima de `days` días desde `firstDay`: sol de 08:00 a 17:00 locales con POA 800 W/m² y 30 °C.
 * `rainByDay` agrega lluvia (mm) a las 14:00 de ese día.
 */
function weather(
  firstDay: string,
  days: number,
  rainByDay: Record<string, number> = {},
): SimWeatherHour[] {
  const hours: SimWeatherHour[] = [];
  const start = startOfLocalDay(firstDay, TZ).getTime();
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * 24 * HOUR;
    const day = new Date(dayStart + 12 * HOUR).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      const sunny = h >= 8 && h < 17;
      hours.push({
        ts: new Date(dayStart + h * HOUR),
        poaWm2: sunny ? 800 : 0,
        tempAmbC: 30,
        precipitationMm: h === 14 ? (rainByDay[day] ?? 0) : 0,
      });
    }
  }
  return hours;
}

/** Energía por día local (kWh) a partir de las lecturas. */
function dailyEnergy(readings: { ts: Date; powerKw: number }[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const r of readings) {
    const day = new Date(r.ts.getTime() - 7 * HOUR).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.powerKw * 0.25);
  }
  return byDay;
}

function run(
  p: SimulatedPlant,
  firstDay: string,
  days: number,
  opts: { rain?: Record<string, number>; cleanings?: Date[] } = {},
) {
  const w = weather(firstDay, days, opts.rain);
  return simulateReadings({
    plant: p,
    weather: w,
    cleanings: opts.cleanings ?? [],
    rainResetMm: 2,
    since: w[0]!.ts,
    until: new Date(w.at(-1)!.ts.getTime() + HOUR),
  });
}

describe('modelo base', () => {
  it('aplica la fórmula de specs/04 §3 (5 kWp, G 900, 38 °C, eficiencia 0.89)', () => {
    // T_cell = 66.125 °C; F_temp = 0.8355; P_dc = 3.75975 kW.
    expect(
      simulatedPowerKw({ capacityKwp: 5, noctC: 45, gammaPctPerC: -0.4 }, 0.89, 900, 38),
    ).toBeCloseTo(3.75975 * 0.89, 6);
    expect(simulatedPowerKw({ capacityKwp: 5, noctC: 45, gammaPctPerC: -0.4 }, 0.89, 0, 38)).toBe(
      0,
    );
  });

  it('solo hay lecturas con sol, cada 15 min, con contador diario que se reinicia a medianoche', () => {
    const readings = run(plant(), '2026-10-01', 2);
    // 9 horas de sol × 4 intervalos × 2 días.
    expect(readings).toHaveLength(72);
    const day1 = readings.slice(0, 36);
    const day2 = readings.slice(36);
    for (const day of [day1, day2]) {
      for (let i = 1; i < day.length; i++) {
        expect(day[i]!.energyTodayKwh).toBeGreaterThan(day[i - 1]!.energyTodayKwh);
      }
    }
    expect(day2[0]!.energyTodayKwh).toBeLessThan(day1.at(-1)!.energyTodayKwh);
    expect(day1.at(-1)!.energyTodayKwh).toBeCloseTo(
      day1.reduce((s, r) => s + r.powerKw * 0.25, 0),
      2,
    );
  });

  it('recorta la potencia al límite AC del inversor', () => {
    const readings = run(plant([], { ac_limit_kw: 2.5 }), '2026-10-01', 1);
    expect(Math.max(...readings.map((r) => r.powerKw))).toBe(2.5);
  });

  it('el ruido es determinista y con σ ≈ noise_pct', () => {
    const noisy = plant([], { noise_pct: 2 });
    const a = run(noisy, '2026-10-01', 30);
    const b = run(noisy, '2026-10-01', 30);
    expect(b).toEqual(a);
    const clean = simulatedPowerKw(noisy, 0.89, 800, 30);
    const rel = a.map((r) => r.powerKw / clean - 1);
    const mean = rel.reduce((s, x) => s + x, 0) / rel.length;
    const sd = Math.sqrt(rel.reduce((s, x) => s + (x - mean) ** 2, 0) / rel.length);
    expect(Math.abs(mean)).toBeLessThan(0.005);
    expect(sd).toBeGreaterThan(0.015);
    expect(sd).toBeLessThan(0.025);
  });
});

describe('escenario de suciedad', () => {
  const soiling: SimulationScenario = { type: 'soiling', start: '2026-10-01', rate_pct_per_day: 1 };
  const clean = dailyEnergy(run(plant(), '2026-10-01', 12));

  it('la pérdida crece linealmente desde el inicio', () => {
    const dirty = dailyEnergy(run(plant([soiling]), '2026-10-01', 10));
    const ratio = (d: string) => (dirty.get(d) ?? 0) / (clean.get(d) ?? 1);
    // A mediodía del día n la pérdida es ~(n + 0.5) %.
    expect(ratio('2026-10-01')).toBeCloseTo(0.995, 2);
    expect(ratio('2026-10-05')).toBeCloseTo(0.955, 2);
    expect(ratio('2026-10-10')).toBeCloseTo(0.905, 2);
    for (let d = 2; d <= 10; d++) {
      const day = `2026-10-${String(d).padStart(2, '0')}`;
      const prev = `2026-10-${String(d - 1).padStart(2, '0')}`;
      expect(ratio(day)).toBeLessThan(ratio(prev));
    }
  });

  it('se reinicia con lluvia ≥ rain_reset_mm, pero no con una llovizna', () => {
    const rained = dailyEnergy(
      run(plant([soiling]), '2026-10-01', 10, { rain: { '2026-10-06': 3 } }),
    );
    const drizzle = dailyEnergy(
      run(plant([soiling]), '2026-10-01', 10, { rain: { '2026-10-06': 1 } }),
    );
    const ratio = (m: Map<string, number>, d: string) => (m.get(d) ?? 0) / (clean.get(d) ?? 1);
    // Al día siguiente de la lluvia la planta está casi limpia.
    expect(ratio(rained, '2026-10-07')).toBeGreaterThan(0.98);
    expect(ratio(rained, '2026-10-07')).toBeGreaterThan(ratio(rained, '2026-10-05'));
    // Y la suciedad vuelve a crecer desde ahí.
    expect(ratio(rained, '2026-10-10')).toBeLessThan(ratio(rained, '2026-10-07'));
    // La llovizna no lava.
    expect(ratio(drizzle, '2026-10-07')).toBeCloseTo(0.935, 2);
  });

  it('se reinicia con un evento de limpieza', () => {
    const cleaning = new Date('2026-10-08T01:00:00Z'); // 18:00 locales del 7
    const washed = dailyEnergy(run(plant([soiling]), '2026-10-01', 10, { cleanings: [cleaning] }));
    const ratio = (d: string) => (washed.get(d) ?? 0) / (clean.get(d) ?? 1);
    expect(ratio('2026-10-07')).toBeCloseTo(0.935, 2);
    expect(ratio('2026-10-08')).toBeGreaterThan(0.99);
  });

  it('antes del inicio del escenario no hay pérdida', () => {
    const later = dailyEnergy(run(plant([{ ...soiling, start: '2026-10-05' }]), '2026-10-01', 6));
    expect(later.get('2026-10-04')).toBeCloseTo(clean.get('2026-10-04') ?? 0, 6);
    expect(later.get('2026-10-06')).toBeLessThan(clean.get('2026-10-06') ?? 0);
  });
});

describe('escenario de falla de string', () => {
  it('es un escalón: sin cambio antes del inicio y pérdida constante después', () => {
    const failure: SimulationScenario = {
      type: 'string_failure',
      start: '2026-10-05',
      loss_pct: 33,
      end: null,
    };
    const energy = dailyEnergy(run(plant([failure]), '2026-10-01', 9));
    const clean = dailyEnergy(run(plant(), '2026-10-01', 9));
    const ratio = (d: string) => (energy.get(d) ?? 0) / (clean.get(d) ?? 1);
    expect(ratio('2026-10-04')).toBeCloseTo(1, 4);
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-09'])
      expect(ratio(d)).toBeCloseTo(0.67, 4);
  });

  it('con fecha de fin se recupera al día siguiente', () => {
    const failure: SimulationScenario = {
      type: 'string_failure',
      start: '2026-10-02',
      loss_pct: 50,
      end: '2026-10-03',
    };
    const energy = dailyEnergy(run(plant([failure]), '2026-10-01', 5));
    const clean = dailyEnergy(run(plant(), '2026-10-01', 5));
    expect((energy.get('2026-10-03') ?? 0) / (clean.get('2026-10-03') ?? 1)).toBeCloseTo(0.5, 4);
    expect((energy.get('2026-10-04') ?? 0) / (clean.get('2026-10-04') ?? 1)).toBeCloseTo(1, 4);
  });

  it('las fechas son locales (zona de la empresa), no UTC', () => {
    const failure: SimulationScenario = {
      type: 'string_failure',
      start: '2026-10-02',
      loss_pct: 50,
      end: null,
    };
    const readings = run(plant([failure]), '2026-10-01', 2);
    // 2026-10-02 00:00 local = 07:00 UTC; a las 16:00 locales del día 1 aún no hay falla.
    const day1Late = readings.find((r) => r.ts.toISOString() === '2026-10-01T23:00:00.000Z');
    const day2 = readings.find((r) => r.ts.toISOString() === '2026-10-02T16:00:00.000Z');
    expect(day1Late?.powerKw).toBeCloseTo(simulatedPowerKw(plant(), 0.89, 800, 30), 3);
    expect(day2?.powerKw).toBeCloseTo(simulatedPowerKw(plant(), 0.89, 800, 30) * 0.5, 3);
  });
});

describe('escenario offline', () => {
  it('no devuelve lecturas en la ventana; antes y después sí', () => {
    const offline: SimulationScenario = {
      type: 'offline',
      start: '2026-10-01T19:00:00Z', // 12:00 local
      end: '2026-10-02T17:00:00Z', // 10:00 local del día 2
    };
    const readings = run(plant([offline]), '2026-10-01', 3);
    const inWindow = readings.filter(
      (r) => r.ts >= new Date('2026-10-01T19:00:00Z') && r.ts < new Date('2026-10-02T17:00:00Z'),
    );
    expect(inWindow).toHaveLength(0);
    expect(readings.some((r) => r.ts < new Date('2026-10-01T19:00:00Z'))).toBe(true);
    expect(readings.some((r) => r.ts >= new Date('2026-10-02T17:00:00Z'))).toBe(true);
    // El contador sigue: al volver refleja lo producido durante la desconexión.
    const back = readings.find((r) => r.ts.toISOString() === '2026-10-02T17:00:00.000Z');
    expect(back?.energyTodayKwh).toBeGreaterThan(back!.powerKw * 0.25 * 4);
  });

  it('sin fecha de fin sigue desconectada', () => {
    const offline: SimulationScenario = {
      type: 'offline',
      start: '2026-10-02T07:00:00Z',
      end: null,
    };
    const readings = run(plant([offline]), '2026-10-01', 4);
    expect(readings.every((r) => r.ts < new Date('2026-10-02T07:00:00Z'))).toBe(true);
    expect(readings).toHaveLength(36);
  });
});

describe('escenario de sombra', () => {
  it('reduce la potencia solo en las horas locales indicadas', () => {
    const shading: SimulationScenario = {
      type: 'shading',
      start: '2026-10-01',
      loss_pct: 25,
      local_hours: [15, 16],
    };
    const readings = run(plant([shading]), '2026-10-01', 1);
    const full = simulatedPowerKw(plant(), 0.89, 800, 30);
    for (const r of readings) {
      const localH = (r.ts.getUTCHours() - 7 + 24) % 24;
      expect(r.powerKw, r.ts.toISOString()).toBeCloseTo(
        [15, 16].includes(localH) ? full * 0.75 : full,
        3,
      );
    }
  });
});

describe('rainResetTimes', () => {
  it('marca la hora en que la lluvia del día alcanza el umbral', () => {
    const w = weather('2026-10-01', 3, { '2026-10-02': 2.5, '2026-10-03': 1.5 });
    const resets = rainResetTimes(w, TZ, 2);
    expect(resets.map((d) => d.toISOString())).toEqual(['2026-10-02T22:00:00.000Z']);
  });
});

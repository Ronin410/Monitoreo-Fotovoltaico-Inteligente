import { hashString, normal, seededRandom } from './random.js';
import type { SimulationProfile, SimulationScenario } from './simulation.js';
import { localDate, localHour, startOfLocalDay } from './time.js';

// Simulador de inversor (specs/04 §3). Función pura: genera la telemetría cada 15 min a partir
// del clima guardado de la planta, así el motor de rendimiento ve datos coherentes.
//
//   G      = POA del clima (W/m²)
//   T_cell = T_amb + (NOCT − 20) / 800 × G
//   F_temp = 1 + (γ/100) × (T_cell − 25)
//   P_dc   = kWp × (G / 1000) × F_temp
//   P_ac   = P_dc × eficiencia × f_suciedad × f_falla × f_sombra × (1 + ruido)
//   P_ac   = min(P_ac, ac_limit_kw)

const INTERVAL_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Tope de pérdida por suciedad: más allá ya no es realista sin lavar. */
const MAX_SOILING_LOSS_PCT = 60;

export type SimWeatherHour = {
  ts: Date;
  poaWm2: number;
  tempAmbC: number;
  precipitationMm: number;
};

export type SimulatedPlant = {
  id: string;
  capacityKwp: number;
  noctC: number;
  /** %/°C, negativo. */
  gammaPctPerC: number;
  /** Zona horaria de la empresa: fechas de escenarios y horas de sombra son locales. */
  timezone: string;
  profile: SimulationProfile;
};

export type SimulatedReading = {
  /** Inicio del intervalo de 15 min, UTC. */
  ts: Date;
  powerKw: number;
  /** Contador diario del inversor (se reinicia a medianoche local). */
  energyTodayKwh: number;
};

export type SimulationInput = {
  plant: SimulatedPlant;
  /**
   * Clima por hora. Debe cubrir desde la medianoche local del día de `since` (para el contador
   * diario) y, si hay suciedad, desde el inicio del escenario (para los reinicios por lluvia).
   */
  weather: SimWeatherHour[];
  /** Limpiezas registradas (eventos `cleaning`): reinician la suciedad. */
  cleanings: Date[];
  /** Lluvia diaria que lava los paneles (settings.thresholds.rain_reset_mm). */
  rainResetMm: number;
  since: Date;
  until: Date;
};

type Factors = { soiling: number; failure: number; shading: number };

/** Inicio (UTC) del día local siguiente a YYYY-MM-DD. */
function nextLocalDay(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return startOfLocalDay(next, tz).getTime();
}

/**
 * Momentos en que la lluvia lava los paneles: la hora en que la lluvia acumulada del día local
 * alcanza `rainResetMm`.
 */
export function rainResetTimes(weather: SimWeatherHour[], tz: string, rainResetMm: number): Date[] {
  const resets: Date[] = [];
  const byDay = new Map<string, SimWeatherHour[]>();
  for (const h of [...weather].sort((a, b) => a.ts.getTime() - b.ts.getTime())) {
    const day = localDate(h.ts, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), h]);
  }
  for (const hours of byDay.values()) {
    let total = 0;
    for (const h of hours) {
      total += h.precipitationMm;
      if (total >= rainResetMm) {
        resets.push(new Date(h.ts.getTime() + HOUR_MS));
        break;
      }
    }
  }
  return resets;
}

function scenarioFactors(
  ts: Date,
  scenarios: SimulationScenario[],
  tz: string,
  resets: number[],
): Factors {
  const t = ts.getTime();
  const factors: Factors = { soiling: 1, failure: 1, shading: 1 };
  for (const s of scenarios) {
    switch (s.type) {
      case 'soiling': {
        const start = startOfLocalDay(s.start, tz).getTime();
        if (t < start) break;
        // La suciedad crece desde el último lavado (lluvia o limpieza) o desde el inicio.
        const lastReset = resets.filter((r) => r <= t && r > start).at(-1) ?? start;
        const lossPct = Math.min(
          s.rate_pct_per_day * ((t - lastReset) / DAY_MS),
          MAX_SOILING_LOSS_PCT,
        );
        factors.soiling *= 1 - lossPct / 100;
        break;
      }
      case 'string_failure': {
        const start = startOfLocalDay(s.start, tz).getTime();
        const end = s.end ? nextLocalDay(s.end, tz) : Infinity;
        if (t >= start && t < end) factors.failure *= 1 - s.loss_pct / 100;
        break;
      }
      case 'shading': {
        const start = startOfLocalDay(s.start, tz).getTime();
        if (t >= start && s.local_hours.includes(localHour(ts, tz))) {
          factors.shading *= 1 - s.loss_pct / 100;
        }
        break;
      }
      case 'offline':
        break;
    }
  }
  return factors;
}

function isOffline(ts: Date, scenarios: SimulationScenario[]): boolean {
  const t = ts.getTime();
  return scenarios.some(
    (s) =>
      s.type === 'offline' &&
      t >= new Date(s.start).getTime() &&
      (s.end === null || t < new Date(s.end).getTime()),
  );
}

/** Potencia AC simulada (kW) en un intervalo, sin ruido ni recorte. */
export function simulatedPowerKw(
  plant: Pick<SimulatedPlant, 'capacityKwp' | 'noctC' | 'gammaPctPerC'>,
  efficiency: number,
  poaWm2: number,
  tempAmbC: number,
): number {
  if (poaWm2 <= 0) return 0;
  const tCell = tempAmbC + ((plant.noctC - 20) / 800) * poaWm2;
  const fTemp = 1 + (plant.gammaPctPerC / 100) * (tCell - 25);
  return Math.max(0, plant.capacityKwp * (poaWm2 / 1000) * fTemp * efficiency);
}

/**
 * Lecturas cada 15 min en [since, until). Solo hay lecturas con sol (POA > 0), como un inversor
 * real; durante un escenario `offline` no se devuelve nada, aunque el contador diario sigue.
 */
export function simulateReadings(input: SimulationInput): SimulatedReading[] {
  const { plant, rainResetMm } = input;
  const { profile, timezone: tz } = plant;
  const weatherByHour = new Map(input.weather.map((h) => [h.ts.getTime(), h]));
  const resets = [...rainResetTimes(input.weather, tz, rainResetMm), ...input.cleanings]
    .map((d) => d.getTime())
    .sort((a, b) => a - b);

  // El contador diario se acumula desde la medianoche local del primer día.
  const firstDayStart = startOfLocalDay(localDate(input.since, tz), tz).getTime();
  const begin = Math.ceil(firstDayStart / INTERVAL_MS) * INTERVAL_MS;
  const readings: SimulatedReading[] = [];
  let currentDay = '';
  let counter = 0;

  for (let t = begin; t < input.until.getTime(); t += INTERVAL_MS) {
    const ts = new Date(t);
    const day = localDate(ts, tz);
    if (day !== currentDay) {
      currentDay = day;
      counter = 0;
    }
    const hour = weatherByHour.get(Math.floor(t / HOUR_MS) * HOUR_MS);
    if (!hour || hour.poaWm2 <= 0) continue;

    const f = scenarioFactors(ts, profile.scenarios, tz, resets);
    const random = seededRandom(hashString(`${profile.seed}:${plant.id}:${ts.toISOString()}`));
    const noise = (profile.noise_pct / 100) * normal(random);
    const raw =
      simulatedPowerKw(plant, profile.system_efficiency, hour.poaWm2, hour.tempAmbC) *
      f.soiling *
      f.failure *
      f.shading *
      (1 + noise);
    const powerKw = Math.min(Math.max(0, raw), profile.ac_limit_kw);
    counter += powerKw * 0.25;

    if (t < input.since.getTime() || isOffline(ts, profile.scenarios)) continue;
    readings.push({
      ts,
      powerKw: Math.round(powerKw * 10_000) / 10_000,
      energyTodayKwh: Math.round(counter * 10_000) / 10_000,
    });
  }
  return readings;
}

// specs/05 §1 — Cálculo por hora. La temperatura de celda cambia hora por hora, por eso la
// energía esperada se calcula por hora y luego se suma (no con un factor diario).

export type PanelParams = {
  capacityKwp: number;
  noctC: number;
  /** %/°C, negativo (por ejemplo −0.40). */
  gammaPctPerC: number;
};

export type HourInput = {
  /** POA promedio de la hora (W/m²); null si no hay clima para esa hora. */
  poaWm2: number | null;
  tempAmbC: number | null;
  /** Σ energía de los intervalos de 15 min de la hora (kWh). */
  energyKwh: number;
  /** Intervalos de telemetría con datos en la hora (0–4). */
  intervals: number;
};

export type HourResult = {
  hasWeather: boolean;
  /** kWh/m² en la hora. */
  irradiationKwhM2: number;
  tCellC: number | null;
  fTemp: number | null;
  /** Energía teórica STC (kWh). */
  expectedStcKwh: number;
  /** Energía esperada corregida por temperatura (kWh). */
  expectedTempKwh: number;
  energyKwh: number;
  /** Cubierta = tiene clima y al menos 3 de sus 4 intervalos de telemetría. */
  covered: boolean;
};

export const F_TEMP_MIN = 0.5;
export const F_TEMP_MAX = 1.1;
const MIN_COVERED_INTERVALS = 3;

export function cellTemperatureC(tempAmbC: number, poaWm2: number, noctC: number): number {
  return tempAmbC + ((noctC - 20) / 800) * poaWm2;
}

export function temperatureFactor(tCellC: number, gammaPctPerC: number): number {
  const f = 1 + (gammaPctPerC / 100) * (tCellC - 25);
  return Math.min(Math.max(f, F_TEMP_MIN), F_TEMP_MAX);
}

export function computeHour(hour: HourInput, panel: PanelParams): HourResult {
  if (hour.poaWm2 === null || hour.tempAmbC === null) {
    return {
      hasWeather: false,
      irradiationKwhM2: 0,
      tCellC: null,
      fTemp: null,
      expectedStcKwh: 0,
      expectedTempKwh: 0,
      energyKwh: hour.energyKwh,
      covered: false,
    };
  }
  const g = Math.max(0, hour.poaWm2);
  const h = g / 1000;
  const tCell = cellTemperatureC(hour.tempAmbC, g, panel.noctC);
  const fTemp = temperatureFactor(tCell, panel.gammaPctPerC);
  const eStc = panel.capacityKwp * h;
  return {
    hasWeather: true,
    irradiationKwhM2: h,
    tCellC: tCell,
    fTemp,
    expectedStcKwh: eStc,
    expectedTempKwh: eStc * fTemp,
    energyKwh: hour.energyKwh,
    covered: hour.intervals >= MIN_COVERED_INTERVALS,
  };
}

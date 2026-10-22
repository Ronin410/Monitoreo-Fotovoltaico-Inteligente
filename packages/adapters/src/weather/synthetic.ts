import { incidenceCos, seededRandom, sunPosition, sunTimes } from '@pv/core';
import {
  hoursBetween,
  type WeatherHour,
  type WeatherProvider,
  type WeatherRequest,
} from './types.js';

// Clima sintético para demo y pruebas sin red (specs/04 §2). Determinista: el mismo lugar y
// día dan siempre el mismo clima, y plantas cercanas (lat/lon a 2 decimales) comparten días
// nublados y lluvia. Solo la irradiancia en el plano depende de la orientación de cada planta.

export type SyntheticWeatherOptions = {
  /** Temperatura máxima de un día despejado (°C), a las 15:00 hora solar. Por defecto 38. */
  maxTempC?: number;
  /** Temperatura mínima, al amanecer. Por defecto 25. */
  minTempC?: number;
  /** Probabilidad de día nublado. Por defecto 0.15 (specs/04: entre 10 % y 20 %). */
  cloudyDayProbability?: number;
};

type DayWeather = { cloudy: boolean; factor: number; rainMm: number; rainHours: number[] };

const HOUR_MS = 3_600_000;
const DEG = Math.PI / 180;

/** Fecha según la hora solar local (UTC + longitud / 15). */
function solarDate(ts: Date, lon: number): string {
  return new Date(ts.getTime() + (lon / 15) * HOUR_MS).toISOString().slice(0, 10);
}

/** Hora solar local decimal (0–24). */
function solarHour(ts: Date, lon: number): number {
  const h = ts.getUTCHours() + ts.getUTCMinutes() / 60 + lon / 15;
  return ((h % 24) + 24) % 24;
}

export class SyntheticWeatherProvider implements WeatherProvider {
  readonly name = 'synthetic';
  private readonly maxTempC: number;
  private readonly minTempC: number;
  private readonly cloudyP: number;

  constructor(options: SyntheticWeatherOptions = {}) {
    this.maxTempC = options.maxTempC ?? 38;
    this.minTempC = options.minTempC ?? 25;
    this.cloudyP = options.cloudyDayProbability ?? 0.15;
  }

  private day(lat: number, lon: number, date: string): DayWeather {
    const r = seededRandom(`clima:${lat.toFixed(2)}:${lon.toFixed(2)}:${date}`);
    const cloudy = r() < this.cloudyP;
    const factor = cloudy ? 0.2 + 0.4 * r() : 1;
    const rains = cloudy && r() < 0.4;
    const rainMm = rains ? 2 + 10 * r() : 0;
    const start = 13 + Math.floor(r() * 3);
    const rainHours = rains ? [start, start + 1, start + 2] : [];
    return { cloudy, factor, rainMm, rainHours };
  }

  private temperature(ts: Date, lat: number, lon: number, day: DayWeather): number {
    const max = this.maxTempC - (day.cloudy ? 4 : 0);
    const { sunrise } = sunTimes(ts, lat, lon);
    const sunriseH = sunrise ? solarHour(sunrise, lon) : 6.5;
    const h = solarHour(ts, lon);
    const peak = 15;
    if (h >= sunriseH && h <= peak) {
      // Sube del mínimo al amanecer al máximo a las 15:00.
      const x = (h - sunriseH) / (peak - sunriseH);
      return this.minTempC + ((max - this.minTempC) * (1 - Math.cos(Math.PI * x))) / 2;
    }
    // Baja del máximo a las 15:00 al mínimo del siguiente amanecer.
    const hoursSincePeak = h > peak ? h - peak : h + 24 - peak;
    const x = hoursSincePeak / (24 - peak + sunriseH);
    return max - ((max - this.minTempC) * (1 - Math.cos(Math.PI * x))) / 2;
  }

  async fetchHourly(req: WeatherRequest): Promise<WeatherHour[]> {
    const lat = Number(req.lat.toFixed(2));
    const lon = Number(req.lon.toFixed(2));
    return hoursBetween(req.from, req.to).map((ts) => {
      const mid = new Date(ts.getTime() + HOUR_MS / 2);
      const date = solarDate(mid, lon);
      const day = this.day(lat, lon, date);
      const hourly = seededRandom(`clima:${lat}:${lon}:${ts.toISOString()}`);
      const sun = sunPosition(mid, lat, lon);

      let ghi = 0;
      let poa = 0;
      if (sun.elevationDeg > 0) {
        const sinEl = Math.sin(sun.elevationDeg * DEG);
        const variation = day.cloudy ? 0.9 + 0.2 * hourly() : 0.98 + 0.04 * hourly();
        ghi = 1000 * sinEl ** 1.15 * day.factor * variation;
        // Transposición aproximada: 80 % directa sobre el plano, 20 % difusa isotrópica.
        const ratio = Math.min(incidenceCos(sun, req.tiltDeg, req.azimuthDeg) / sinEl, 3);
        poa = ghi * (0.8 * ratio + (0.2 * (1 + Math.cos(req.tiltDeg * DEG))) / 2);
      }

      const solarH = Math.floor(solarHour(mid, lon));
      const precipitation = day.rainHours.includes(solarH) ? day.rainMm / day.rainHours.length : 0;
      const cloudCover = day.cloudy ? 60 + 35 * hourly() : 15 * hourly();
      return {
        ts,
        poaWm2: round(poa, 2),
        ghiWm2: round(ghi, 2),
        tempAmbC: round(this.temperature(mid, lat, lon, day), 2),
        cloudCoverPct: round(cloudCover, 2),
        precipitationMm: round(precipitation, 2),
      };
    });
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

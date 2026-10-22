import { z } from 'zod';
import type { WeatherHour, WeatherProvider, WeatherRequest } from './types.js';

// Adaptador de Open-Meteo (specs/01: proveedor por defecto porque entrega irradiancia en el
// plano inclinado). ⚠️ Antes de producción verificar sus términos de uso comercial; con
// WEATHER_API_KEY se usa el servidor para clientes comerciales.
//
// Según su documentación:
// - `global_tilted_irradiance` requiere `tilt` y `azimuth`; su azimut usa 0 = sur, −90 = este,
//   90 = oeste (el nuestro: 180 = sur), por eso se resta 180.
// - Las variables de radiación y la precipitación horarias son el promedio/suma de la hora
//   ANTERIOR a la etiqueta: el valor de las 13:00 corresponde a 12:00–13:00. Se asigna al
//   inicio del intervalo. Temperatura y nubosidad son instantáneas y se toman en la etiqueta.
// - El endpoint de pronóstico acepta fechas de hasta ~3 meses atrás (alcanza para el backfill de
//   90 días); más atrás habría que usar el endpoint histórico.

const HOUR_MS = 3_600_000;
const HOURLY = [
  'global_tilted_irradiance',
  'shortwave_radiation',
  'temperature_2m',
  'cloud_cover',
  'precipitation',
] as const;

const series = z.array(z.number().nullable());
const responseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    global_tilted_irradiance: series,
    shortwave_radiation: series,
    temperature_2m: series,
    cloud_cover: series,
    precipitation: series,
  }),
});

export type OpenMeteoOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly name = 'open-meteo';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenMeteoOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** URL de la consulta (pública para pruebas). */
  buildUrl(req: WeatherRequest): string {
    const base = this.options.apiKey
      ? 'https://customer-api.open-meteo.com/v1/forecast'
      : 'https://api.open-meteo.com/v1/forecast';
    // El intervalo de la etiqueta T es [T−1h, T): se pide hasta una hora después de `to`.
    const lastLabel = new Date(req.to.getTime());
    const params = new URLSearchParams({
      latitude: req.lat.toFixed(4),
      longitude: req.lon.toFixed(4),
      hourly: HOURLY.join(','),
      tilt: String(req.tiltDeg),
      azimuth: String(req.azimuthDeg - 180),
      timezone: 'GMT',
      start_date: req.from.toISOString().slice(0, 10),
      end_date: lastLabel.toISOString().slice(0, 10),
    });
    if (this.options.apiKey) params.set('apikey', this.options.apiKey);
    return `${base}?${params.toString()}`;
  }

  async fetchHourly(req: WeatherRequest): Promise<WeatherHour[]> {
    const res = await this.fetchImpl(this.buildUrl(req), {
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
    });
    if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
    const { hourly } = responseSchema.parse(await res.json());

    const hours: WeatherHour[] = [];
    hourly.time.forEach((label, i) => {
      // Etiquetas en GMT sin zona ("2026-10-20T13:00").
      const end = new Date(`${label}:00Z`);
      const ts = new Date(end.getTime() - HOUR_MS);
      if (ts < req.from || ts >= req.to) return;
      const poa = hourly.global_tilted_irradiance[i];
      const ghi = hourly.shortwave_radiation[i];
      const temp = hourly.temperature_2m[i];
      const cloud = hourly.cloud_cover[i];
      const rain = hourly.precipitation[i];
      // Una hora sin datos se omite (el motor la trata como hora sin clima).
      if (poa == null || ghi == null || temp == null || cloud == null || rain == null) return;
      hours.push({
        ts,
        poaWm2: Math.max(0, poa),
        ghiWm2: Math.max(0, ghi),
        tempAmbC: temp,
        cloudCoverPct: cloud,
        precipitationMm: Math.max(0, rain),
      });
    });
    return hours;
  }
}

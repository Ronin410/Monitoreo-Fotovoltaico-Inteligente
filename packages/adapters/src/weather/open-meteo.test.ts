import { describe, expect, it, vi } from 'vitest';
import { OpenMeteoWeatherProvider } from './open-meteo.js';

// Prueba la conversión de nuestro adaptador con respuestas con la forma documentada por
// Open-Meteo. No verifica la API real.

const req = {
  lat: 24.8,
  lon: -107.39,
  tiltDeg: 20,
  azimuthDeg: 180,
  from: new Date('2026-10-20T18:00:00Z'),
  to: new Date('2026-10-20T20:00:00Z'),
};

function provider(body: unknown, status = 200, apiKey?: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return {
    fetchMock,
    weather: new OpenMeteoWeatherProvider({
      apiKey,
      fetchImpl: fetchMock as unknown as typeof fetch,
    }),
  };
}

const body = {
  hourly: {
    time: ['2026-10-20T18:00', '2026-10-20T19:00', '2026-10-20T20:00', '2026-10-20T21:00'],
    global_tilted_irradiance: [700, 850, 900, null],
    shortwave_radiation: [650, 800, 860, 800],
    temperature_2m: [33, 35, 36.5, 37],
    cloud_cover: [5, 10, 0, 20],
    precipitation: [0, 0, 0.4, 0],
  },
};

describe('OpenMeteoWeatherProvider', () => {
  it('pide irradiancia inclinada convirtiendo el azimut a su convención (0 = sur)', () => {
    const { weather } = provider(body);
    const url = new URL(weather.buildUrl(req));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('tilt')).toBe('20');
    expect(url.searchParams.get('azimuth')).toBe('0');
    expect(new URL(weather.buildUrl({ ...req, azimuthDeg: 90 })).searchParams.get('azimuth')).toBe(
      '-90',
    );
    expect(new URL(weather.buildUrl({ ...req, azimuthDeg: 270 })).searchParams.get('azimuth')).toBe(
      '90',
    );
    expect(url.searchParams.get('hourly')).toContain('global_tilted_irradiance');
    expect(url.searchParams.get('timezone')).toBe('GMT');
  });

  it('asigna cada valor al inicio de su hora y filtra el rango pedido', async () => {
    const { weather } = provider(body);
    const hours = await weather.fetchHourly(req);
    // La etiqueta 19:00 es la hora 18:00–19:00; la de 20:00 es 19:00–20:00.
    expect(hours.map((h) => h.ts.toISOString())).toEqual([
      '2026-10-20T18:00:00.000Z',
      '2026-10-20T19:00:00.000Z',
    ]);
    expect(hours[0]).toMatchObject({ poaWm2: 850, ghiWm2: 800, tempAmbC: 35 });
    expect(hours[1]).toMatchObject({ poaWm2: 900, precipitationMm: 0.4 });
  });

  it('omite horas sin datos', async () => {
    const { weather } = provider(body);
    const hours = await weather.fetchHourly({ ...req, to: new Date('2026-10-20T21:00:00Z') });
    expect(hours.map((h) => h.ts.getUTCHours())).toEqual([18, 19]);
  });

  it('con llave usa el servidor comercial', () => {
    const { weather } = provider(body, 200, 'llave-comercial');
    const url = new URL(weather.buildUrl(req));
    expect(url.host).toBe('customer-api.open-meteo.com');
    expect(url.searchParams.get('apikey')).toBe('llave-comercial');
  });

  it('falla con un error genérico ante una respuesta no exitosa o inválida', async () => {
    await expect(provider({}, 429).weather.fetchHourly(req)).rejects.toThrow(
      'Open-Meteo respondió 429',
    );
    await expect(provider({ hourly: {} }).weather.fetchHourly(req)).rejects.toThrow();
  });
});

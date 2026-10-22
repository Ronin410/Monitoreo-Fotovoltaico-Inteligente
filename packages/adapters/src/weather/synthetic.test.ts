import { sunPosition } from '@pv/core';
import { describe, expect, it } from 'vitest';
import { SyntheticWeatherProvider } from './synthetic.js';

const CULIACAN = { lat: 24.8, lon: -107.39, tiltDeg: 20, azimuthDeg: 180 };
// Día local completo en Culiacán (UTC−7): 00:00 a 24:00 locales.
const day = (date: string) => ({
  from: new Date(`${date}T07:00:00Z`),
  to: new Date(new Date(`${date}T07:00:00Z`).getTime() + 24 * 3_600_000),
});

const weather = new SyntheticWeatherProvider();

describe('SyntheticWeatherProvider', () => {
  it('24 horas con POA > 0 solo cuando el sol está sobre el horizonte', async () => {
    const hours = await weather.fetchHourly({ ...CULIACAN, ...day('2026-10-20') });
    expect(hours).toHaveLength(24);
    for (const h of hours) {
      const mid = new Date(h.ts.getTime() + 1_800_000);
      const up = sunPosition(mid, CULIACAN.lat, CULIACAN.lon).elevationDeg > 0;
      expect(h.poaWm2 > 0, h.ts.toISOString()).toBe(up);
    }
    const sunny = hours.filter((h) => h.poaWm2 > 0).length;
    expect(sunny).toBeGreaterThanOrEqual(11);
    expect(sunny).toBeLessThanOrEqual(13);
  });

  it('es determinista', async () => {
    const a = await weather.fetchHourly({ ...CULIACAN, ...day('2026-09-01') });
    const b = await weather.fetchHourly({ ...CULIACAN, ...day('2026-09-01') });
    expect(b).toEqual(a);
  });

  it('valores físicos razonables en un año: POA, temperatura, nubosidad y lluvia', async () => {
    const hours = await weather.fetchHourly({
      ...CULIACAN,
      from: new Date('2026-01-01T07:00:00Z'),
      to: new Date('2027-01-01T07:00:00Z'),
    });
    expect(Math.max(...hours.map((h) => h.poaWm2))).toBeLessThan(1200);
    expect(Math.max(...hours.map((h) => h.poaWm2))).toBeGreaterThan(850);
    expect(Math.min(...hours.map((h) => h.tempAmbC))).toBeGreaterThanOrEqual(24.9);
    expect(Math.max(...hours.map((h) => h.tempAmbC))).toBeLessThanOrEqual(38.1);

    // Días nublados (nubosidad media > 50 %) entre 10 % y 20 % (specs/04 §2).
    const byDay = new Map<string, typeof hours>();
    for (const h of hours) {
      const key = new Date(h.ts.getTime() - 7 * 3_600_000).toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), h]);
    }
    const days = [...byDay.values()];
    const cloudy = days.filter((d) => d.reduce((s, h) => s + h.cloudCoverPct, 0) / d.length > 50);
    expect(cloudy.length / days.length).toBeGreaterThan(0.08);
    expect(cloudy.length / days.length).toBeLessThan(0.22);
    // La lluvia solo cae en días nublados.
    for (const d of days) {
      const rain = d.reduce((s, h) => s + h.precipitationMm, 0);
      const cloud = d.reduce((s, h) => s + h.cloudCoverPct, 0) / d.length;
      if (rain > 0) expect(cloud).toBeGreaterThan(50);
    }
    expect(days.some((d) => d.reduce((s, h) => s + h.precipitationMm, 0) >= 2)).toBe(true);
  });

  it('la orientación cambia la irradiancia: al este de mañana, al oeste de tarde', async () => {
    const at = (iso: string, azimuthDeg: number) =>
      weather
        .fetchHourly({
          ...CULIACAN,
          tiltDeg: 30,
          azimuthDeg,
          from: new Date(iso),
          to: new Date(new Date(iso).getTime() + 3_600_000),
        })
        .then((h) => h[0]?.poaWm2 ?? 0);
    // 09:00 y 16:00 locales.
    expect(await at('2026-10-21T16:00:00Z', 90)).toBeGreaterThan(
      await at('2026-10-21T16:00:00Z', 270),
    );
    expect(await at('2026-10-21T23:00:00Z', 270)).toBeGreaterThan(
      await at('2026-10-21T23:00:00Z', 90),
    );
  });

  it('plantas cercanas comparten el clima del día', async () => {
    const a = await weather.fetchHourly({ ...CULIACAN, ...day('2026-08-15') });
    const b = await weather.fetchHourly({
      ...CULIACAN,
      lat: 24.801,
      lon: -107.389,
      ...day('2026-08-15'),
    });
    expect(b.map((h) => h.precipitationMm)).toEqual(a.map((h) => h.precipitationMm));
    expect(b.map((h) => h.cloudCoverPct)).toEqual(a.map((h) => h.cloudCoverPct));
  });
});

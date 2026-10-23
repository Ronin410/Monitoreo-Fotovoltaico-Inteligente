import { describe, expect, it } from 'vitest';
import { hashString, normal, seededRandom } from './random.js';
import { incidenceCos, isWithinSunWindow, sunPosition, sunTimes, sunWindow } from './solar.js';

const CULIACAN = { lat: 24.8, lon: -107.39 };

describe('sunPosition', () => {
  it('el sol está alto al mediodía solar y bajo el horizonte a medianoche en Culiacán', () => {
    // Mediodía solar en Culiacán ≈ 19:10 UTC.
    const noon = sunPosition(new Date('2026-10-20T19:10:00Z'), CULIACAN.lat, CULIACAN.lon);
    expect(noon.elevationDeg).toBeGreaterThan(50);
    expect(noon.elevationDeg).toBeLessThan(60);
    expect(noon.azimuthDeg).toBeGreaterThan(170);
    expect(noon.azimuthDeg).toBeLessThan(190);
    const midnight = sunPosition(new Date('2026-10-20T07:10:00Z'), CULIACAN.lat, CULIACAN.lon);
    expect(midnight.elevationDeg).toBeLessThan(-40);
  });

  it('por la mañana el sol está al este y por la tarde al oeste', () => {
    expect(sunPosition(new Date('2026-10-20T15:00:00Z'), 24.8, -107.39).azimuthDeg).toBeLessThan(
      150,
    );
    expect(sunPosition(new Date('2026-10-20T23:00:00Z'), 24.8, -107.39).azimuthDeg).toBeGreaterThan(
      210,
    );
  });

  it('calcula amanecer y atardecer (~11.5 h de día en octubre)', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-10-20T19:00:00Z'), 24.8, -107.39);
    const hours = ((sunset?.getTime() ?? 0) - (sunrise?.getTime() ?? 0)) / 3_600_000;
    expect(hours).toBeGreaterThan(11);
    expect(hours).toBeLessThan(12);
  });
});

describe('incidenceCos', () => {
  it('un panel inclinado hacia el sol recibe más que uno horizontal en invierno', () => {
    const sun = { elevationDeg: 45, azimuthDeg: 180 };
    expect(incidenceCos(sun, 0, 180)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(incidenceCos(sun, 45, 180)).toBeCloseTo(1, 6);
    expect(incidenceCos(sun, 45, 0)).toBeCloseTo(0, 6); // de espaldas al sol
    expect(incidenceCos({ elevationDeg: -10, azimuthDeg: 180 }, 20, 180)).toBe(0);
  });
});

describe('seededRandom', () => {
  it('es determinista y depende de la semilla', () => {
    const a = seededRandom('planta-1');
    const b = seededRandom('planta-1');
    const c = seededRandom('planta-2');
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(hashString('abc')).toBe(hashString('abc'));
  });

  it('normal() tiene media ~0 y desviación ~1', () => {
    const r = seededRandom(42);
    const xs = Array.from({ length: 20_000 }, () => normal(r));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
});

describe('sunWindow', () => {
  const TZ = 'America/Mazatlan';
  it('usa el día local aunque en UTC ya sea el día siguiente', () => {
    // 17:30 locales del 20 de octubre = 00:30 UTC del 21.
    const w = sunWindow(new Date('2026-10-21T00:30:00Z'), 24.8, -107.39, TZ);
    expect(w?.from.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(isWithinSunWindow(new Date('2026-10-21T00:30:00Z'), 24.8, -107.39, TZ)).toBe(true);
  });

  it('de noche está fuera; 20 min antes del amanecer está dentro', () => {
    expect(isWithinSunWindow(new Date('2026-10-20T09:00:00Z'), 24.8, -107.39, TZ)).toBe(false); // 02:00
    const w = sunWindow(new Date('2026-10-20T19:00:00Z'), 24.8, -107.39, TZ);
    const before = new Date((w?.from.getTime() ?? 0) + 10 * 60_000);
    expect(isWithinSunWindow(before, 24.8, -107.39, TZ)).toBe(true);
    expect(isWithinSunWindow(new Date((w?.from.getTime() ?? 0) - 60_000), 24.8, -107.39, TZ)).toBe(
      false,
    );
  });
});

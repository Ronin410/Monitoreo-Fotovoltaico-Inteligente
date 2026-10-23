import { getPosition, getTimes } from 'suncalc';
import { localDate, startOfLocalDay } from './time.js';

// Geometría solar. Convención interna (specs/04 §2): azimut en grados desde el norte en sentido
// horario, 180 = sur, 90 = este, 270 = oeste.

const DEG = Math.PI / 180;

export type SunPosition = {
  /** Elevación sobre el horizonte, en grados (negativa de noche). */
  elevationDeg: number;
  /** Azimut en la convención interna (180 = sur). */
  azimuthDeg: number;
};

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  // suncalc 2: altitud aparente (con refracción) y azimut en grados, desde el norte en sentido
  // horario; la misma convención interna.
  const p = getPosition(date, lat, lon);
  return { elevationDeg: p.altitude, azimuthDeg: p.azimuth };
}

/** Amanecer y atardecer; null si el sol no sale o no se pone ese día (no ocurre en México). */
export function sunTimes(
  date: Date,
  lat: number,
  lon: number,
): { sunrise: Date | null; sunset: Date | null } {
  const t = getTimes(date, lat, lon);
  return { sunrise: t.sunrise, sunset: t.sunset };
}

/** Coseno del ángulo de incidencia del sol sobre un plano inclinado (0 si le da por detrás). */
export function incidenceCos(sun: SunPosition, tiltDeg: number, panelAzimuthDeg: number): number {
  // Con el sol bajo el horizonte no hay incidencia, aunque la fórmula dé positivo en un plano
  // inclinado.
  if (sun.elevationDeg <= 0) return 0;
  const el = sun.elevationDeg * DEG;
  const tilt = tiltDeg * DEG;
  const cos =
    Math.sin(el) * Math.cos(tilt) +
    Math.cos(el) * Math.sin(tilt) * Math.cos((sun.azimuthDeg - panelAzimuthDeg) * DEG);
  return Math.max(0, cos);
}

const SUN_WINDOW_MARGIN_MS = 30 * 60_000;

/**
 * Ventana de consulta de telemetría (specs/04 §1): de amanecer − 30 min a atardecer + 30 min del
 * día local de la planta. Se calcula desde el mediodía local para no tomar el día UTC siguiente.
 */
export function sunWindow(
  now: Date,
  lat: number,
  lon: number,
  timeZone: string,
): { from: Date; to: Date } | null {
  const noon = new Date(
    startOfLocalDay(localDate(now, timeZone), timeZone).getTime() + 12 * 3_600_000,
  );
  const { sunrise, sunset } = sunTimes(noon, lat, lon);
  if (!sunrise || !sunset) return null;
  return {
    from: new Date(sunrise.getTime() - SUN_WINDOW_MARGIN_MS),
    to: new Date(sunset.getTime() + SUN_WINDOW_MARGIN_MS),
  };
}

export function isWithinSunWindow(now: Date, lat: number, lon: number, timeZone: string): boolean {
  const w = sunWindow(now, lat, lon, timeZone);
  return w !== null && now >= w.from && now <= w.to;
}

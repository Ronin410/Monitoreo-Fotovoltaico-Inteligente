import { median } from './baseline.js';

// specs/05 §6 — Índice frente a vecinas. Solo plantas de la misma empresa (privacidad entre
// tenants); el llamador nunca debe pasar plantas de otra empresa.

export type NeighborCandidate = {
  plantId: string;
  lat: number | null;
  lon: number | null;
  postalCode: string;
  /** PR_temp del día; solo cuentan las vecinas con día válido. */
  prTemp: number | null;
  prBaseline: number | null;
  isValidDay: boolean;
};

export type NeighborResult = {
  /** r_planta / mediana(r_vecinas); null si no hay suficientes vecinas. */
  index: number | null;
  count: number;
  method: 'radius' | 'postal_code' | null;
};

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** r = PR_temp / línea base: cada planta se normaliza contra sí misma. */
const ratio = (c: Pick<NeighborCandidate, 'prTemp' | 'prBaseline'>) =>
  (c.prTemp as number) / (c.prBaseline as number);

const usable = (c: NeighborCandidate) =>
  c.isValidDay && c.prTemp !== null && c.prBaseline !== null && c.prBaseline > 0;

export function neighborIndex(
  target: NeighborCandidate,
  candidates: NeighborCandidate[],
  opts: { radiusKm: number; minCount: number },
): NeighborResult {
  const none: NeighborResult = { index: null, count: 0, method: null };
  if (!usable(target)) return none;
  const others = candidates.filter((c) => c.plantId !== target.plantId && usable(c));

  let neighbors: NeighborCandidate[] = [];
  let method: NeighborResult['method'] = null;
  if (target.lat !== null && target.lon !== null) {
    const { lat, lon } = target;
    neighbors = others.filter(
      (c) =>
        c.lat !== null && c.lon !== null && haversineKm(lat, lon, c.lat, c.lon) <= opts.radiusKm,
    );
    method = 'radius';
  }
  if (neighbors.length < opts.minCount) {
    neighbors = others.filter((c) => c.postalCode === target.postalCode);
    method = 'postal_code';
  }
  if (neighbors.length < opts.minCount) return none;
  return { index: ratio(target) / median(neighbors.map(ratio)), count: neighbors.length, method };
}

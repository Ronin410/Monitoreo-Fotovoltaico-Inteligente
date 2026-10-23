import { haversineKm } from '../performance/neighbors.js';
import type { AlertThresholds } from './types.js';

// specs/06 §1 — Evento de zona: si la mayoría de las plantas de un grupo bajan a la vez, es el
// clima (polvo, humo, nubosidad mal reportada), no una falla de cada planta.

export type ZonePlantDay = {
  plantId: string;
  postalCode: string;
  lat: number | null;
  lon: number | null;
  isValidDay: boolean;
  deviationPct: number | null;
};

/**
 * Plantas con `zone_event` en el día. Grupos: las plantas válidas del mismo código postal y,
 * para cada planta válida con ubicación, ella con sus vecinas válidas a ≤ radio. Un grupo con
 * ≥ `neighbor_min_count` plantas donde al menos `zone_event_pct` % superan
 * `soiling_deviation_pct` marca a todo el grupo. Solo plantas de una misma empresa.
 */
export function zoneEventPlants(days: ZonePlantDay[], t: AlertThresholds): Set<string> {
  const valid = days.filter((d) => d.isValidDay && d.deviationPct !== null);
  const groups: ZonePlantDay[][] = [];

  const byPostal = new Map<string, ZonePlantDay[]>();
  for (const d of valid) byPostal.set(d.postalCode, [...(byPostal.get(d.postalCode) ?? []), d]);
  groups.push(...byPostal.values());

  for (const center of valid) {
    if (center.lat === null || center.lon === null) continue;
    const { lat, lon } = center;
    groups.push(
      valid.filter(
        (d) =>
          d.lat !== null &&
          d.lon !== null &&
          haversineKm(lat, lon, d.lat, d.lon) <= t.neighbor_radius_km,
      ),
    );
  }

  const marked = new Set<string>();
  for (const group of groups) {
    if (group.length < t.neighbor_min_count) continue;
    const low = group.filter((d) => (d.deviationPct as number) > t.soiling_deviation_pct).length;
    if ((100 * low) / group.length >= t.zone_event_pct) {
      for (const d of group) marked.add(d.plantId);
    }
  }
  return marked;
}

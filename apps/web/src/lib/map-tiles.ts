// Mosaicos de los mapas (docs/plan-lanzamiento.md §2). En pruebas, OpenStreetMap gratuito; en
// producción, un proveedor comercial: su política de uso no permite uso comercial intensivo de
// tile.openstreetmap.org. Se configura en el build con NEXT_PUBLIC_MAP_TILE_URL (con {z}, {x} y
// {y}, por ejemplo la URL de MapTiler con su llave) y NEXT_PUBLIC_MAP_ATTRIBUTION.

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type MapTiles = { url: string; attribution: string };

/** Valida la configuración; si falta o es inválida, usa OpenStreetMap. */
export function mapTiles(env: {
  url?: string | undefined;
  attribution?: string | undefined;
}): MapTiles {
  const url = env.url?.trim();
  const valid =
    !!url && /^https:\/\//.test(url) && ['{z}', '{x}', '{y}'].every((p) => url.includes(p));
  if (!valid) return { url: OSM_URL, attribution: OSM_ATTRIBUTION };
  // La atribución es obligatoria con cualquier proveedor; sin texto propio se cita OpenStreetMap,
  // que es la fuente de datos de la mayoría.
  return { url, attribution: env.attribution?.trim() || OSM_ATTRIBUTION };
}

// Next.js sustituye estas variables al compilar (deben escribirse completas, sin desestructurar).
export const MAP_TILES = mapTiles({
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL,
  attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
});

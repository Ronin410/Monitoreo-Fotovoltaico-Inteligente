import {
  ingestWeather,
  ingestWeatherCompany,
  weatherBackfill,
  type WeatherHour,
} from '@pv/adapters';
import { floorToHour, localDate, localHour, startOfLocalDay } from '@pv/core';
import { listActiveCompanies, withTenant, type TenantDb } from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';

// Ingesta de clima (specs/04 §2): se pide por ubicación y orientación; plantas con el mismo
// lat/lon (redondeado a 2 decimales), inclinación y orientación comparten la llamada, pero se
// guarda una fila por planta.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Hora local a la que se vuelve a pedir el día completo (los proveedores corrigen valores). */
const FULL_DAY_REFRESH_HOUR = 21;

type PlantLocation = {
  id: string;
  lat: number;
  lon: number;
  tiltDeg: number;
  azimuthDeg: number;
};

/** Plantas activas de la empresa con ubicación (opcionalmente solo algunas). */
async function activePlants(tx: TenantDb, plantIds?: string[]): Promise<PlantLocation[]> {
  const plants = await tx.solarPlant.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      lat: { not: null },
      lon: { not: null },
      ...(plantIds ? { id: { in: plantIds } } : {}),
    },
    select: { id: true, lat: true, lon: true, tiltDeg: true, azimuthDeg: true },
  });
  return plants.map((p) => ({
    id: p.id,
    lat: Number(p.lat),
    lon: Number(p.lon),
    tiltDeg: Number(p.tiltDeg),
    azimuthDeg: Number(p.azimuthDeg),
  }));
}

function groupKey(p: PlantLocation): string {
  return `${p.lat.toFixed(2)}:${p.lon.toFixed(2)}:${p.tiltDeg}:${p.azimuthDeg}`;
}

/** Upsert de las horas de una planta (idempotente: repetir no duplica, actualiza). */
async function upsertHours(
  tx: TenantDb,
  companyId: string,
  plantId: string,
  source: string,
  hours: WeatherHour[],
): Promise<void> {
  if (hours.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO plant_weather_hourly
      (company_id, plant_id, ts, poa_wm2, ghi_wm2, temp_amb_c, cloud_cover_pct,
       precipitation_mm, source, updated_at)
    SELECT ${companyId}::uuid, ${plantId}::uuid, t.ts, t.poa, t.ghi, t.temp, t.cloud, t.rain,
           ${source}, now()
    FROM unnest(
      ${hours.map((h) => h.ts)}::timestamptz[],
      ${hours.map((h) => h.poaWm2)}::numeric[],
      ${hours.map((h) => h.ghiWm2)}::numeric[],
      ${hours.map((h) => h.tempAmbC)}::numeric[],
      ${hours.map((h) => h.cloudCoverPct)}::numeric[],
      ${hours.map((h) => h.precipitationMm)}::numeric[]
    ) AS t(ts, poa, ghi, temp, cloud, rain)
    ON CONFLICT (plant_id, ts) DO UPDATE SET
      poa_wm2 = EXCLUDED.poa_wm2,
      ghi_wm2 = EXCLUDED.ghi_wm2,
      temp_amb_c = EXCLUDED.temp_amb_c,
      cloud_cover_pct = EXCLUDED.cloud_cover_pct,
      precipitation_mm = EXCLUDED.precipitation_mm,
      source = EXCLUDED.source,
      updated_at = now()`;
}

/**
 * Pide el clima de las plantas en [from, to) agrupadas por ubicación y orientación, y lo guarda.
 * La consulta al proveedor ocurre fuera de la transacción.
 */
export async function ingestWeatherRange(
  ctx: JobContext,
  companyId: string,
  range: { from: Date; to: Date },
  plantIds?: string[],
) {
  const plants = await withTenant(ctx.db, companyId, (tx) => activePlants(tx, plantIds));
  const groups = new Map<string, PlantLocation[]>();
  for (const p of plants) groups.set(groupKey(p), [...(groups.get(groupKey(p)) ?? []), p]);

  let hoursStored = 0;
  for (const members of groups.values()) {
    const first = members[0];
    if (!first) continue;
    const hours = await ctx.weather.fetchHourly({
      lat: Number(first.lat.toFixed(2)),
      lon: Number(first.lon.toFixed(2)),
      tiltDeg: first.tiltDeg,
      azimuthDeg: first.azimuthDeg,
      from: range.from,
      to: range.to,
    });
    await withTenant(
      ctx.db,
      companyId,
      async (tx) => {
        for (const plant of members) {
          await upsertHours(tx, companyId, plant.id, ctx.weather.name, hours);
        }
      },
      { timeout: 60_000 },
    );
    hoursStored += hours.length * members.length;
  }
  return {
    plants: plants.length,
    provider_calls: groups.size,
    hours_stored: hoursStored,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}

/**
 * Rango de una corrida horaria: las últimas 3 horas cerradas; a las 21:00 locales, desde la
 * medianoche local (specs/04 §2).
 */
export function hourlyRange(at: Date, timeZone: string): { from: Date; to: Date } {
  const to = floorToHour(at);
  const lastThree = new Date(to.getTime() - 3 * HOUR_MS);
  if (localHour(at, timeZone) !== FULL_DAY_REFRESH_HOUR) return { from: lastThree, to };
  return { from: startOfLocalDay(localDate(at, timeZone), timeZone), to };
}

export const ingestWeatherJob = registerJob(ingestWeather, async (_payload, ctx) => {
  const at = floorToHour(ctx.now()).toISOString();
  const companies = await listActiveCompanies(ctx.serviceDb);
  let enqueued = 0;
  for (const company of companies) {
    if (await ctx.queue.enqueue(ingestWeatherCompany, { company_id: company.id, at })) enqueued++;
  }
  return { companies: companies.length, enqueued };
});

export const ingestWeatherCompanyJob = registerJob(ingestWeatherCompany, async (payload, ctx) => {
  const company = await ctx.serviceDb.company.findUniqueOrThrow({
    where: { id: payload.company_id },
    select: { timezone: true },
  });
  const at = payload.at ? new Date(payload.at) : ctx.now();
  return ingestWeatherRange(ctx, payload.company_id, hourlyRange(at, company.timezone));
});

export const weatherBackfillJob = registerJob(weatherBackfill, async (payload, ctx) => {
  const to = floorToHour(ctx.now());
  const from = new Date(to.getTime() - payload.days * DAY_MS);
  return ingestWeatherRange(ctx, payload.company_id, { from, to }, [payload.plant_id]);
});

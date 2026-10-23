import { ingestTelemetry, ingestTelemetryPlant, type RawReading } from '@pv/adapters';
import {
  floorToInterval,
  isWithinSunWindow,
  normalizeReadings,
  simulationProfileSchema,
  type NormalizedInterval,
} from '@pv/core';
import { listActiveCompanies, withTenant, type TenantDb } from '@pv/db';
import { registerJob } from '../runtime.js';

// Ingesta de telemetría (specs/04 §1).

const HOUR_MS = 3_600_000;
const MAX_LOOKBACK_MS = 7 * 24 * HOUR_MS;
/** Solape con la última lectura para corregir datos tardíos. */
const OVERLAP_MS = HOUR_MS;

/**
 * Falla del proveedor (credenciales, API caída, adaptador sin implementar). Su mensaje nunca
 * incluye lo que respondió el proveedor: podría repetir credenciales. Distingue "error nuestro o
 * del proveedor" de "el inversor no reporta" (specs/04, specs/06 §2 offline).
 */
export class ProviderError extends Error {
  constructor(cause: unknown) {
    super(`provider_error: ${(cause as Error)?.name ?? 'Error'}`);
    this.name = 'ProviderError';
  }
}

async function upsertIntervals(
  tx: TenantDb,
  companyId: string,
  plantId: string,
  intervals: NormalizedInterval[],
): Promise<void> {
  if (intervals.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO telemetry_readings
      (company_id, plant_id, ts, power_kw, energy_kwh, energy_today_kwh, inverter_temp_c,
       status_code, updated_at)
    SELECT ${companyId}::uuid, ${plantId}::uuid, t.ts, t.power, t.energy, t.counter, t.temp,
           t.status, now()
    FROM unnest(
      ${intervals.map((i) => i.ts)}::timestamptz[],
      ${intervals.map((i) => i.powerKw)}::numeric[],
      ${intervals.map((i) => i.energyKwh)}::numeric[],
      ${intervals.map((i) => i.energyTodayKwh)}::numeric[],
      ${intervals.map((i) => i.inverterTempC)}::numeric[],
      ${intervals.map((i) => (i.filled ? 'filled' : i.statusCode))}::text[]
    ) AS t(ts, power, energy, counter, temp, status)
    ON CONFLICT (plant_id, ts) DO UPDATE SET
      power_kw = EXCLUDED.power_kw,
      energy_kwh = EXCLUDED.energy_kwh,
      energy_today_kwh = EXCLUDED.energy_today_kwh,
      inverter_temp_c = EXCLUDED.inverter_temp_c,
      status_code = EXCLUDED.status_code,
      updated_at = now()`;
}

export const ingestTelemetryJob = registerJob(ingestTelemetry, async (_payload, ctx) => {
  const now = ctx.now();
  const companies = await listActiveCompanies(ctx.serviceDb);
  let enqueued = 0;
  let outsideSunWindow = 0;
  let withoutLocation = 0;
  for (const company of companies) {
    const plants = await withTenant(ctx.db, company.id, (tx) =>
      tx.solarPlant.findMany({
        where: { deletedAt: null, status: 'active' },
        select: { id: true, lat: true, lon: true },
      }),
    );
    for (const plant of plants) {
      if (plant.lat === null || plant.lon === null) {
        withoutLocation++;
        continue;
      }
      // De noche no hay generación: solo se consulta con sol (± 30 min).
      if (!isWithinSunWindow(now, Number(plant.lat), Number(plant.lon), company.timezone)) {
        outsideSunWindow++;
        continue;
      }
      if (
        await ctx.queue.enqueue(ingestTelemetryPlant, {
          company_id: company.id,
          plant_id: plant.id,
        })
      ) {
        enqueued++;
      }
    }
  }
  return {
    companies: companies.length,
    enqueued,
    outside_sun_window: outsideSunWindow,
    without_location: withoutLocation,
  };
});

export const ingestTelemetryPlantJob = registerJob(ingestTelemetryPlant, async (payload, ctx) => {
  const companyId = payload.company_id;
  const now = ctx.now();
  const { plant, timezone } = await withTenant(ctx.db, companyId, async (tx) => ({
    plant: await tx.solarPlant.findFirst({
      where: { id: payload.plant_id, deletedAt: null, status: 'active' },
      include: { credentials: true },
    }),
    timezone: (await tx.company.findUniqueOrThrow({ where: { id: companyId } })).timezone,
  }));
  if (!plant) return { plant_id: payload.plant_id, skipped: 'plant_not_active' };
  if (!plant.credentials && plant.inverterBrand !== 'simulator') {
    return { plant_id: plant.id, skipped: 'no_credentials' };
  }

  const lastReading = plant.lastReadingAt?.getTime() ?? 0;
  const since = new Date(Math.max(lastReading - OVERLAP_MS, now.getTime() - MAX_LOOKBACK_MS));
  const until = now;

  let readings: RawReading[];
  try {
    // Solo en memoria: las credenciales descifradas nunca se registran.
    const creds = plant.credentials
      ? ctx.cipher.decrypt(plant.credentials, { companyId, plantId: plant.id })
      : {};
    readings = await ctx.adapters(companyId)[plant.inverterBrand].fetchReadings({
      plant: {
        id: plant.id,
        capacityKwp: Number(plant.capacityKwp),
        serial: plant.inverterSerial,
        lat: plant.lat === null ? null : Number(plant.lat),
        lon: plant.lon === null ? null : Number(plant.lon),
        simulationProfile: plant.simulationProfile
          ? simulationProfileSchema.parse(plant.simulationProfile)
          : null,
        noctC: Number(plant.noctC),
        gammaPctPerC: Number(plant.gammaPctPerC),
        timezone,
      },
      creds,
      since,
      until,
    });
  } catch (err) {
    throw new ProviderError(err);
  }

  const windowStart = floorToInterval(since);
  const inWindow = readings.filter((r) => r.ts >= windowStart && r.ts < until);

  const stored = await withTenant(ctx.db, companyId, async (tx) => {
    // Último intervalo guardado antes de la ventana: base para la diferencia del contador.
    const previous = await tx.telemetryReading.findFirst({
      where: { plantId: plant.id, ts: { lt: windowStart } },
      orderBy: { ts: 'desc' },
      select: { ts: true, energyTodayKwh: true },
    });
    const intervals = normalizeReadings(
      inWindow,
      previous && {
        ts: previous.ts,
        energyTodayKwh: previous.energyTodayKwh === null ? null : Number(previous.energyTodayKwh),
      },
    );
    await upsertIntervals(tx, companyId, plant.id, intervals);
    const latest = intervals.filter((i) => !i.filled).at(-1);
    if (latest && (!plant.lastReadingAt || latest.ts >= plant.lastReadingAt)) {
      await tx.solarPlant.update({
        where: { id: plant.id },
        data: { lastReadingAt: latest.ts, lastPowerKw: latest.powerKw },
      });
    }
    return intervals;
  });

  return {
    plant_id: plant.id,
    since: since.toISOString(),
    until: until.toISOString(),
    readings: inWindow.length,
    intervals: stored.length,
    filled: stored.filter((i) => i.filled).length,
  };
});

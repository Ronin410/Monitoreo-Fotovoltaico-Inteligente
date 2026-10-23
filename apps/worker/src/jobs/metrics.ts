import { alertsEvaluate, metricsDaily, metricsDailyCompany, metricsRecompute } from '@pv/adapters';
import {
  addDays,
  computeBaseline,
  computeDay,
  dailyStatus,
  daysBetween,
  deviationPct,
  lastResetEvent,
  localDate,
  localHour,
  neighborIndex,
  parseCompanySettings,
  predictSoiling,
  rainResetTimes,
  selectNeighbors,
  startOfLocalDay,
  type BaselineSource,
  type DayHourInput,
  type DayResult,
  type SoilingPrediction,
} from '@pv/core';
import { listActiveCompanies, withTenant, type Prisma, type TenantDb } from '@pv/db';
import { registerJob, type JobContext } from '../runtime.js';

// Job metrics.daily (specs/05 §9): por planta carga telemetría y clima del día → §1–3 → §4–5 →
// §7; con todas las plantas listas → §6 → §8. Idempotente: upsert por (plant_id, date).

const HOUR_MS = 3_600_000;
const METRICS_HOUR = 22;
/** Historia que se carga para línea base (90 días) y tendencia de suciedad. */
const HISTORY_DAYS = 120;

type Plant = {
  id: string;
  clientId: string;
  postalCode: string;
  colonia: string;
  lat: number | null;
  lon: number | null;
  capacityKwp: number;
  noctC: number;
  gammaPctPerC: number;
};

type PlantDay = {
  plant: Plant;
  day: DayResult;
  baseline: { value: number; source: BaselineSource };
  deviation: number | null;
  soiling: SoilingPrediction;
};

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));

/** Horas del día local con su clima y la telemetría agregada por hora. */
async function loadDayHours(
  tx: TenantDb,
  plantIds: string[],
  from: Date,
  to: Date,
): Promise<
  Map<
    string,
    {
      hours: DayHourInput[];
      hasTelemetry: boolean;
      rainHours: { ts: Date; precipitationMm: number }[];
    }
  >
> {
  const [weather, telemetry] = await Promise.all([
    tx.plantWeatherHourly.findMany({
      where: { plantId: { in: plantIds }, ts: { gte: from, lt: to } },
    }),
    tx.telemetryReading.findMany({
      where: { plantId: { in: plantIds }, ts: { gte: from, lt: to } },
      select: { plantId: true, ts: true, energyKwh: true },
    }),
  ]);
  const hourStarts: number[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += HOUR_MS) hourStarts.push(t);

  const result = new Map<
    string,
    {
      hours: DayHourInput[];
      hasTelemetry: boolean;
      rainHours: { ts: Date; precipitationMm: number }[];
    }
  >();
  for (const plantId of plantIds) {
    const w = new Map(weather.filter((x) => x.plantId === plantId).map((x) => [x.ts.getTime(), x]));
    const t = telemetry.filter((x) => x.plantId === plantId);
    const byHour = new Map<number, { energy: number; intervals: number }>();
    for (const r of t) {
      const h = Math.floor(r.ts.getTime() / HOUR_MS) * HOUR_MS;
      const acc = byHour.get(h) ?? { energy: 0, intervals: 0 };
      acc.energy += Number(r.energyKwh);
      acc.intervals += 1;
      byHour.set(h, acc);
    }
    const hours = hourStarts.map((h) => {
      const wh = w.get(h);
      const th = byHour.get(h);
      return {
        poaWm2: num(wh?.poaWm2 ?? null),
        tempAmbC: num(wh?.tempAmbC ?? null),
        cloudCoverPct: num(wh?.cloudCoverPct ?? null),
        precipitationMm: num(wh?.precipitationMm ?? null),
        energyKwh: th?.energy ?? 0,
        intervals: th?.intervals ?? 0,
      };
    });
    result.set(plantId, {
      hours,
      hasTelemetry: t.length > 0,
      rainHours: [...w.values()].map((x) => ({
        ts: x.ts,
        precipitationMm: Number(x.precipitationMm),
      })),
    });
  }
  return result;
}

/** Calcula y guarda las métricas de la fecha local `date` para la empresa. */
export async function computeCompanyDay(ctx: JobContext, companyId: string, date: string) {
  return withTenant(
    ctx.db,
    companyId,
    async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const tz = company.timezone;
      const { thresholds } = parseCompanySettings(company.settings);
      const dayStart = startOfLocalDay(date, tz);
      const dayEnd = startOfLocalDay(addDays(date, 1), tz);

      const plantRows = await tx.solarPlant.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          OR: [
            { commissioningDate: null },
            { commissioningDate: { lte: new Date(`${date}T00:00:00Z`) } },
          ],
        },
      });
      const plants: Plant[] = plantRows.map((p) => ({
        id: p.id,
        clientId: p.clientId,
        postalCode: p.postalCode,
        colonia: p.colonia,
        lat: num(p.lat),
        lon: num(p.lon),
        capacityKwp: Number(p.capacityKwp),
        noctC: Number(p.noctC),
        gammaPctPerC: Number(p.gammaPctPerC),
      }));
      if (plants.length === 0) return { date, plants: 0 };
      const ids = plants.map((p) => p.id);

      const hoursByPlant = await loadDayHours(tx, ids, dayStart, dayEnd);
      const historyFrom = new Date(`${addDays(date, -HISTORY_DAYS)}T00:00:00Z`);
      const [history, events, suddenDrops, openAlerts] = await Promise.all([
        tx.plantDailyMetric.findMany({
          where: {
            plantId: { in: ids },
            date: { gte: historyFrom, lt: new Date(`${date}T00:00:00Z`) },
          },
          select: { plantId: true, date: true, prTemp: true, prBaseline: true, isValidDay: true },
          orderBy: { date: 'asc' },
        }),
        tx.plantEvent.findMany({
          where: { plantId: { in: ids }, occurredAt: { lte: dayEnd } },
          select: { plantId: true, type: true, occurredAt: true, source: true },
        }),
        tx.alert.findMany({
          where: { plantId: { in: ids }, type: 'sudden_drop', detectedAt: { lt: dayEnd } },
          select: { plantId: true, detectedAt: true, resolvedAt: true },
        }),
        tx.alert.findMany({
          where: { plantId: { in: ids }, status: { in: ['open', 'acknowledged'] } },
          select: { plantId: true, severity: true },
        }),
      ]);

      // 1. Evento rain_cleaning automático (specs/05 §7): reinicia la tendencia de suciedad.
      let rainCleanings = 0;
      for (const plant of plants) {
        const data = hoursByPlant.get(plant.id);
        const [rainAt] = rainResetTimes(
          (data?.rainHours ?? []).map((h) => ({ ...h, poaWm2: 0, tempAmbC: 0 })),
          tz,
          thresholds.rain_reset_mm,
        );
        if (!rainAt) continue;
        // La hora del lavado puede caer justo al cierre del día: se compara el instante exacto.
        const exists = events.some(
          (e) =>
            e.plantId === plant.id &&
            e.type === 'rain_cleaning' &&
            e.source === 'auto' &&
            e.occurredAt.getTime() === rainAt.getTime(),
        );
        if (exists) continue;
        await tx.plantEvent.create({
          data: {
            companyId,
            plantId: plant.id,
            type: 'rain_cleaning',
            source: 'auto',
            occurredAt: rainAt,
            notes: `Lluvia ≥ ${thresholds.rain_reset_mm} mm`,
          },
        });
        events.push({
          plantId: plant.id,
          type: 'rain_cleaning',
          occurredAt: rainAt,
          source: 'auto',
        });
        rainCleanings++;
      }

      const historyOf = (plantId: string) => history.filter((h) => h.plantId === plantId);
      const suddenDropActiveOn = (plantId: string, day: string) => {
        const start = startOfLocalDay(day, tz);
        const end = startOfLocalDay(addDays(day, 1), tz);
        return suddenDrops.some(
          (a) =>
            a.plantId === plantId &&
            a.detectedAt < end &&
            (a.resolvedAt === null || a.resolvedAt >= start),
        );
      };
      const isoDay = (d: Date) => d.toISOString().slice(0, 10);

      // 2. §1–3 por planta y línea base propia (§4).
      const days = plants.map((plant) => {
        const data = hoursByPlant.get(plant.id);
        const day = computeDay(data?.hours ?? [], plant, thresholds, data?.hasTelemetry ?? false);
        const baselineHistory = historyOf(plant.id).map((h) => ({
          date: isoDay(h.date),
          prTemp: num(h.prTemp),
          isValidDay: h.isValidDay,
          suddenDropActive: suddenDropActiveOn(plant.id, isoDay(h.date)),
        }));
        const own = computeBaseline(date, baselineHistory);
        return { plant, day, own, history: baselineHistory };
      });

      // Línea base provisional: mediana de las líneas base propias de las vecinas (§4, §6).
      const withOwn = days.filter((d) => d.own.source === 'own');
      const results: PlantDay[] = days.map(({ plant, day, own, history: h }) => {
        let baseline = own;
        if (own.source !== 'own') {
          const { neighbors } = selectNeighbors(
            { ...plant, plantId: plant.id },
            withOwn.map((d) => ({ ...d.plant, plantId: d.plant.id, value: d.own.value })),
            { radiusKm: thresholds.neighbor_radius_km, minCount: thresholds.neighbor_min_count },
          );
          baseline = computeBaseline(
            date,
            h,
            neighbors.map((n) => n.value),
          );
        }
        const deviation =
          day.isValidDay && day.prTemp !== null ? deviationPct(baseline.value, day.prTemp) : null;

        // §7: puntos = días válidos posteriores al último reinicio, con r = PR_temp / base (%).
        const reset = lastResetEvent(
          events.filter((e) => e.plantId === plant.id),
          dayEnd,
        );
        const resetDay = reset ? localDate(reset.occurredAt, tz) : addDays(date, -HISTORY_DAYS);
        const points = historyOf(plant.id)
          .filter(
            (h) =>
              isoDay(h.date) > resetDay &&
              h.isValidDay &&
              h.prTemp !== null &&
              h.prBaseline !== null,
          )
          .map((h) => ({
            day: daysBetween(resetDay, isoDay(h.date)),
            rPct: (100 * Number(h.prTemp)) / Number(h.prBaseline),
          }));
        if (date > resetDay && day.isValidDay && day.prTemp !== null) {
          points.push({
            day: daysBetween(resetDay, date),
            rPct: (100 * day.prTemp) / baseline.value,
          });
        }
        const soiling = predictSoiling(
          points,
          daysBetween(resetDay, date),
          thresholds.soiling_deviation_pct,
        );
        return { plant, day, baseline, deviation, soiling };
      });

      // 3. §6 índice frente a vecinas (misma empresa) y §8 estado; guardar.
      const toCandidate = (r: PlantDay) => ({
        plantId: r.plant.id,
        lat: r.plant.lat,
        lon: r.plant.lon,
        postalCode: r.plant.postalCode,
        prTemp: r.day.prTemp,
        prBaseline: r.baseline.value,
        isValidDay: r.day.isValidDay,
      });
      const candidates = results.map(toCandidate);
      for (const r of results) {
        const neighbors = neighborIndex(toCandidate(r), candidates, {
          radiusKm: thresholds.neighbor_radius_km,
          minCount: thresholds.neighbor_min_count,
        });
        const status = dailyStatus({
          hasWeather: r.day.hasWeather,
          hasTelemetry: r.day.hasTelemetry,
          openAlertSeverities: openAlerts
            .filter((a) => a.plantId === r.plant.id)
            .map((a) => a.severity),
          deviationPct: r.deviation,
          daysToCleaning: r.soiling.daysToCleaning,
          soilingDeviationPct: thresholds.soiling_deviation_pct,
        });
        const values = {
          clientId: r.plant.clientId,
          postalCode: r.plant.postalCode,
          colonia: r.plant.colonia,
          energyKwh: r.day.energyKwh,
          irradiationPoaKwhM2: r.day.irradiationPoaKwhM2,
          expectedStcKwh: r.day.expectedStcKwh,
          expectedTempKwh: r.day.expectedTempKwh,
          specificYieldKwhKwp: r.day.specificYieldKwhKwp,
          pr: r.day.pr,
          prTemp: r.day.prTemp,
          prBaseline: r.baseline.value,
          baselineSource: r.baseline.source,
          deviationPct: r.deviation,
          neighborIndex: neighbors.index,
          neighborCount: neighbors.count,
          tempAmbMaxC: r.day.tempAmbMaxC,
          tCellMaxC: r.day.tCellMaxC,
          cloudCoverAvgPct: r.day.cloudCoverAvgPct,
          rainMm: r.day.rainMm,
          dataCompletenessPct: r.day.dataCompletenessPct,
          isValidDay: r.day.isValidDay,
          invalidReason: r.day.invalidReason,
          soilingSlopePctPerDay: r.soiling.slopePctPerDay,
          daysToCleaning: r.soiling.daysToCleaning,
          predictionConfidence: r.soiling.confidence,
          status,
        };
        await tx.plantDailyMetric.upsert({
          where: { plantId_date: { plantId: r.plant.id, date: new Date(`${date}T00:00:00Z`) } },
          create: {
            ...values,
            companyId,
            plantId: r.plant.id,
            date: new Date(`${date}T00:00:00Z`),
          },
          update: values,
        });
      }

      return {
        date,
        plants: plants.length,
        valid_days: results.filter((r) => r.day.isValidDay).length,
        rain_cleanings: rainCleanings,
      };
    },
    { timeout: 120_000 },
  );
}

export const metricsDailyJob = registerJob(metricsDaily, async (_payload, ctx) => {
  const now = ctx.now();
  let enqueued = 0;
  for (const company of await listActiveCompanies(ctx.serviceDb)) {
    if (localHour(now, company.timezone) !== METRICS_HOUR) continue;
    const date = localDate(now, company.timezone);
    if (await ctx.queue.enqueue(metricsDailyCompany, { company_id: company.id, date })) enqueued++;
  }
  return { enqueued };
});

/** Al terminar encola alerts.evaluate para la empresa y la fecha (specs/05 §9). */
export const metricsDailyCompanyJob = registerJob(metricsDailyCompany, async (payload, ctx) => {
  const stats = await computeCompanyDay(ctx, payload.company_id, payload.date);
  const queued = await ctx.queue.enqueue(alertsEvaluate, {
    company_id: payload.company_id,
    date: payload.date,
  });
  return { ...stats, alerts_enqueued: queued !== null };
});

/**
 * Recálculo de métricas de un rango. No evalúa alertas: reabrir o resolver alertas con fechas
 * pasadas confundiría a los usuarios (specs/PREGUNTAS.md #112).
 */
export const metricsRecomputeJob = registerJob(metricsRecompute, async (payload, ctx) => {
  let days = 0;
  for (let date = payload.from; date <= payload.to; date = addDays(date, 1)) {
    await computeCompanyDay(ctx, payload.company_id, date);
    days++;
  }
  return { from: payload.from, to: payload.to, days };
});

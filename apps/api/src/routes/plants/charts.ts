import {
  addDays,
  can,
  computeHour,
  daysBetween,
  DEFAULT_BASELINE,
  localDate,
  parseCompanySettings,
  startOfLocalDay,
} from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { z } from 'zod';
import { companyAuthOf } from '../../auth/authorize.js';
import { dec } from '../../http/decimal.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';

// Datos de las gráficas del detalle de planta (F6-T4, specs/09 §Detalle de planta).
// /today: operator o technician con un ticket abierto de la planta; /daily-metrics: operator.

const INTERVAL_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
const MAX_RANGE_DAYS = 366;
const OPEN_TICKET = ['pending', 'scheduled', 'in_progress'] as const;

const localDateSchema = z.iso.date({ error: 'Fecha YYYY-MM-DD' });
export const todayQuery = z.object({ date: localDateSchema.optional() });
export const dailyMetricsQuery = z
  .object({ from: localDateSchema.optional(), to: localDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { error: 'from debe ser anterior a to' });

export const todayResponse = z.object({
  date: z.string(),
  timezone: z.string(),
  /** PR de referencia con que se escala la potencia esperada (línea base o 0.85). */
  baseline_pr: z.number(),
  intervals: z.array(
    z.object({
      ts: z.date(),
      power_kw: z.number().nullable(),
      /** Potencia esperada con el clima y el rendimiento normal de la planta. */
      expected_kw: z.number().nullable(),
    }),
  ),
});

export const dailyMetricsResponse = z.object({
  from: z.string(),
  to: z.string(),
  soiling_deviation_pct: z.number(),
  days: z.array(
    z.object({
      date: z.string(),
      energy_kwh: z.number(),
      pr_temp: z.number().nullable(),
      pr_baseline: z.number().nullable(),
      deviation_pct: z.number().nullable(),
      neighbor_index: z.number().nullable(),
      neighbor_count: z.number().int(),
      rain_mm: z.number(),
      is_valid_day: z.boolean(),
      invalid_reason: z.string().nullable(),
      days_to_cleaning: z.number().int().nullable(),
      soiling_slope_pct_per_day: z.number().nullable(),
      status: z.string(),
    }),
  ),
  /** Reinicios de la tendencia (limpiezas, lluvias, reparaciones) del periodo. */
  events: z.array(z.object({ type: z.string(), date: z.string(), source: z.string() })),
});

const plantNotFound = () => new HttpError(404, 'NOT_FOUND', 'Planta no encontrada');
const forbidden = () =>
  new HttpError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción');
const day = (d: string) => new Date(`${d}T00:00:00Z`);

export function plantChartsRouter(db: PrismaClient, now: () => Date): Router {
  const router = Router();

  router.get('/:id/today', async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const query = todayQuery.parse(req.query);
    const data = await withTenant(db, auth.companyId, async (tx) => {
      if (!can(auth.role, 'fleet:read')) {
        // El técnico solo ve plantas de sus tickets abiertos (specs/02); si no, 404 como si no
        // existiera.
        if (auth.role !== 'technician') throw forbidden();
        const ticket = await tx.maintenanceTicket.findFirst({
          where: { plantId: id, assignedToId: auth.userId, status: { in: [...OPEN_TICKET] } },
          select: { id: true },
        });
        if (!ticket) throw plantNotFound();
      }
      const plant = await tx.solarPlant.findFirst({ where: { id, deletedAt: null } });
      if (!plant) throw plantNotFound();
      const { timezone } = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId } });
      const date = query.date ?? localDate(now(), timezone);
      const from = startOfLocalDay(date, timezone);
      const to = startOfLocalDay(addDays(date, 1), timezone);
      const [readings, weather, lastBaseline] = await Promise.all([
        tx.telemetryReading.findMany({
          where: { plantId: id, ts: { gte: from, lt: to } },
          select: { ts: true, powerKw: true },
        }),
        tx.plantWeatherHourly.findMany({
          where: { plantId: id, ts: { gte: from, lt: to } },
          select: { ts: true, poaWm2: true, tempAmbC: true },
        }),
        tx.plantDailyMetric.findFirst({
          where: { plantId: id, date: { lte: day(date) }, prBaseline: { not: null } },
          orderBy: { date: 'desc' },
          select: { prBaseline: true },
        }),
      ]);
      const baseline = dec(lastBaseline?.prBaseline ?? null) ?? DEFAULT_BASELINE;
      const panel = {
        capacityKwp: Number(plant.capacityKwp),
        noctC: Number(plant.noctC),
        gammaPctPerC: Number(plant.gammaPctPerC),
      };
      const power = new Map(readings.map((r) => [r.ts.getTime(), Number(r.powerKw)]));
      const expectedByHour = new Map(
        weather.map((w) => {
          const h = computeHour(
            { poaWm2: Number(w.poaWm2), tempAmbC: Number(w.tempAmbC), energyKwh: 0, intervals: 0 },
            panel,
          );
          // Energía de una hora (kWh) = potencia media (kW).
          return [w.ts.getTime(), h.expectedTempKwh * baseline];
        }),
      );
      const intervals = [];
      for (let t = from.getTime(); t < to.getTime(); t += INTERVAL_MS) {
        const hour = Math.floor(t / HOUR_MS) * HOUR_MS;
        const expected = expectedByHour.get(hour);
        intervals.push({
          ts: new Date(t),
          power_kw: power.get(t) ?? null,
          expected_kw: expected === undefined ? null : Math.round(expected * 1000) / 1000,
        });
      }
      return { date, timezone, baseline_pr: baseline, intervals };
    });
    respond(res, todayResponse, data);
  });

  router.get('/:id/daily-metrics', async (req, res) => {
    const auth = companyAuthOf(req);
    if (!can(auth.role, 'fleet:read')) throw forbidden();
    const { id } = idParam.parse(req.params);
    const query = dailyMetricsQuery.parse(req.query);
    const data = await withTenant(db, auth.companyId, async (tx) => {
      const plant = await tx.solarPlant.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!plant) throw plantNotFound();
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId } });
      const today = localDate(now(), company.timezone);
      const to = query.to ?? addDays(today, -1);
      const from = query.from ?? addDays(to, -29);
      if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
        throw new HttpError(400, 'RANGE_TOO_LARGE', `El rango máximo es de ${MAX_RANGE_DAYS} días`);
      }
      const [days, events] = await Promise.all([
        tx.plantDailyMetric.findMany({
          where: { plantId: id, date: { gte: day(from), lte: day(to) } },
          orderBy: { date: 'asc' },
        }),
        tx.plantEvent.findMany({
          where: {
            plantId: id,
            type: { in: ['cleaning', 'rain_cleaning', 'repair'] },
            occurredAt: {
              gte: startOfLocalDay(from, company.timezone),
              lt: startOfLocalDay(addDays(to, 1), company.timezone),
            },
          },
          orderBy: { occurredAt: 'asc' },
          select: { type: true, occurredAt: true, source: true },
        }),
      ]);
      return {
        from,
        to,
        soiling_deviation_pct: parseCompanySettings(company.settings).thresholds
          .soiling_deviation_pct,
        days: days.map((d) => ({
          date: d.date.toISOString().slice(0, 10),
          energy_kwh: Number(d.energyKwh),
          pr_temp: dec(d.prTemp),
          pr_baseline: dec(d.prBaseline),
          deviation_pct: dec(d.deviationPct),
          neighbor_index: dec(d.neighborIndex),
          neighbor_count: d.neighborCount,
          rain_mm: Number(d.rainMm),
          is_valid_day: d.isValidDay,
          invalid_reason: d.invalidReason,
          days_to_cleaning: d.daysToCleaning,
          soiling_slope_pct_per_day: dec(d.soilingSlopePctPerDay),
          status: d.status,
        })),
        events: events.map((e) => ({
          type: e.type,
          date: localDate(e.occurredAt, company.timezone),
          source: e.source,
        })),
      };
    });
    respond(res, dailyMetricsResponse, data);
  });

  return router;
}

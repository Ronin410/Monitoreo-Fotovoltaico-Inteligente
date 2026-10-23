import { addDays, currentPlantStatus, localDate, startOfLocalDay } from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { dec } from '../../http/decimal.js';
import { respond } from '../../http/respond.js';
import {
  mapResponse,
  summaryResponse,
  topBottomQuery,
  topBottomResponse,
  upcomingCleaningsQuery,
  upcomingCleaningsResponse,
} from './schemas.js';

// Tablero de flota (F6-T2). Roles: company_admin y operator (fleet:read).

const OPEN = ['open', 'acknowledged'] as const;
/** Un día calculado sirve como estado actual si es de hoy, ayer o anteayer. */
const RECENT_DAYS = 2;
const TOP_N = 5;
const MIN_VALID_DAYS = 5;

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function dashboardRouter(db: PrismaClient, now: () => Date): Router {
  const router = Router();
  router.use(requirePermission('fleet:read'));

  router.get('/summary', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const data = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const tz = company.timezone;
      const today = localDate(now(), tz);
      const monthStart = `${today.slice(0, 7)}-01`;
      const active = { deletedAt: null, status: 'active' as const };
      const [plants, clients, todayEnergy, monthEnergy, pr, alerts] = await Promise.all([
        tx.solarPlant.aggregate({ where: active, _count: true, _sum: { capacityKwp: true } }),
        tx.client.count({ where: { deletedAt: null } }),
        tx.telemetryReading.aggregate({
          where: { ts: { gte: startOfLocalDay(today, tz) }, plant: active },
          _sum: { energyKwh: true },
        }),
        // El día de hoy aún no tiene métrica: se suma su telemetría aparte.
        tx.plantDailyMetric.aggregate({
          where: { date: { gte: day(monthStart), lt: day(today) }, plant: active },
          _sum: { energyKwh: true },
        }),
        tx.plantDailyMetric.aggregate({
          where: {
            date: { gte: day(addDays(today, -7)), lt: day(today) },
            isValidDay: true,
            plant: active,
          },
          _avg: { prTemp: true },
        }),
        tx.alert.groupBy({
          by: ['severity', 'type'],
          where: { status: { in: [...OPEN] }, plant: { deletedAt: null } },
          _count: true,
        }),
      ]);
      const count = (s: string) =>
        alerts.filter((a) => a.severity === s).reduce((n, a) => n + a._count, 0);
      const energyToday = dec(todayEnergy._sum.energyKwh) ?? 0;
      return {
        date: today,
        timezone: tz,
        plants: {
          active: plants._count,
          capacity_kwp: dec(plants._sum.capacityKwp) ?? 0,
          clients,
        },
        energy_today_kwh: energyToday,
        energy_month_kwh: (dec(monthEnergy._sum.energyKwh) ?? 0) + energyToday,
        pr_temp_7d: dec(pr._avg.prTemp),
        alerts_open: {
          critical: count('critical'),
          warning: count('warning'),
          info: count('info'),
        },
        offline_plants: alerts
          .filter((a) => a.type === 'offline')
          .reduce((n, a) => n + a._count, 0),
      };
    });
    respond(res, summaryResponse, data);
  });

  router.get('/map', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const plants = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const today = localDate(now(), company.timezone);
      return tx.solarPlant.findMany({
        where: { deletedAt: null, status: 'active', lat: { not: null }, lon: { not: null } },
        select: {
          id: true,
          name: true,
          colonia: true,
          capacityKwp: true,
          lat: true,
          lon: true,
          lastPowerKw: true,
          lastReadingAt: true,
          client: { select: { name: true } },
          alerts: { where: { status: { in: [...OPEN] } }, select: { type: true, severity: true } },
          dailyMetrics: {
            where: { date: { gte: day(addDays(today, -RECENT_DAYS)) } },
            orderBy: { date: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
        orderBy: { name: 'asc' },
      });
    });
    respond(res, mapResponse, {
      plants: plants.map((p) => ({
        id: p.id,
        name: p.name,
        client_name: p.client.name,
        colonia: p.colonia,
        capacity_kwp: Number(p.capacityKwp),
        lat: Number(p.lat),
        lon: Number(p.lon),
        status: currentPlantStatus({
          openAlerts: p.alerts,
          lastDailyStatus: p.dailyMetrics[0]?.status ?? null,
        }),
        last_power_kw: dec(p.lastPowerKw),
        last_reading_at: p.lastReadingAt,
      })),
    });
  });

  router.get('/upcoming-cleanings', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { days } = upcomingCleaningsQuery.parse(req.query);
    const plants = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const today = localDate(now(), company.timezone);
      return tx.solarPlant.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          // Con una caída brusca abierta la tendencia no es de suciedad (specs/PREGUNTAS.md #103).
          alerts: { none: { type: 'sudden_drop', status: { in: [...OPEN] } } },
        },
        select: {
          id: true,
          name: true,
          client: { select: { name: true } },
          dailyMetrics: {
            where: { date: { gte: day(addDays(today, -RECENT_DAYS)) } },
            orderBy: { date: 'desc' },
            take: 1,
            select: {
              date: true,
              daysToCleaning: true,
              predictionConfidence: true,
              deviationPct: true,
              soilingSlopePctPerDay: true,
            },
          },
        },
      });
    });
    const due = plants
      .flatMap((p) => {
        const m = p.dailyMetrics[0];
        if (!m || m.daysToCleaning === null || m.daysToCleaning > days) return [];
        return [
          {
            id: p.id,
            name: p.name,
            client_name: p.client.name,
            days_to_cleaning: m.daysToCleaning,
            confidence: m.predictionConfidence,
            deviation_pct: dec(m.deviationPct),
            soiling_slope_pct_per_day: dec(m.soilingSlopePctPerDay),
            date: isoDay(m.date),
          },
        ];
      })
      .sort((a, b) => a.days_to_cleaning - b.days_to_cleaning || a.name.localeCompare(b.name));
    respond(res, upcomingCleaningsResponse, { days, plants: due });
  });

  router.get('/top-bottom', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { days } = topBottomQuery.parse(req.query);
    const { stats, plants } = await withTenant(db, companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const today = localDate(now(), company.timezone);
      const [stats, plants] = await Promise.all([
        tx.plantDailyMetric.groupBy({
          by: ['plantId'],
          where: {
            date: { gte: day(addDays(today, -days)), lt: day(today) },
            isValidDay: true,
            prTemp: { not: null },
            plant: { deletedAt: null, status: 'active' },
          },
          _avg: { prTemp: true },
          _count: { _all: true },
        }),
        tx.solarPlant.findMany({
          where: { deletedAt: null, status: 'active' },
          select: { id: true, name: true, client: { select: { name: true } } },
        }),
      ]);
      return { stats, plants };
    });
    const byId = new Map(plants.map((p) => [p.id, p]));
    const ranked = stats
      .flatMap((s) => {
        const p = byId.get(s.plantId);
        if (!p || s._count._all < MIN_VALID_DAYS) return [];
        return [
          {
            id: p.id,
            name: p.name,
            client_name: p.client.name,
            pr_temp_avg: Number(s._avg.prTemp),
            valid_days: s._count._all,
          },
        ];
      })
      .sort((a, b) => b.pr_temp_avg - a.pr_temp_avg || a.name.localeCompare(b.name));
    const best = ranked.slice(0, TOP_N);
    // Con pocas plantas, una no aparece en las dos listas.
    const worst = ranked.slice(best.length).reverse().slice(0, TOP_N);
    respond(res, topBottomResponse, { days, min_valid_days: MIN_VALID_DAYS, best, worst });
  });

  return router;
}

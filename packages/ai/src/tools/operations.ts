import { estimatedDailyLossKwh, parseCompanySettings } from '@pv/core';
import type { Prisma } from '@pv/db';
import { z } from 'zod';
import { estimateAlertLoss } from '../explanation/input.js';
import {
  dec,
  isoDay,
  latestPrediction,
  limitSchema,
  OPEN_ALERT,
  periodSchema,
  plantWhere,
  r1,
  r2,
  resolvePeriod,
  startOfPeriod,
  zoneSchema,
} from './context.js';
import { defineTool } from './tool.js';

// Riesgo, alertas y tickets (specs/07 §2).

const ALERT_TYPES = ['offline', 'sudden_drop', 'soiling', 'cleaning_due_soon'] as const;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

const summaryOf = (v: Prisma.JsonValue | null): string | null =>
  v && typeof v === 'object' && !Array.isArray(v) && typeof v.resumen === 'string'
    ? v.resumen
    : null;

export const getPlantsAtRisk = defineTool({
  name: 'get_plants_at_risk',
  description:
    'Plantas que necesitan atención: con alertas abiertas o con lavado estimado dentro del horizonte (días). Ordenadas por urgencia, con motivo, días estimados, confianza y pérdida estimada por día en kWh y MXN (estimación). Úsala para "¿qué plantas necesitan mantenimiento o lavado?".',
  input: z.object({ horizon_days: z.number().int().min(1).max(60).default(14) }).strict(),
  run: async ({ horizon_days }, ctx) => {
    const plants = await ctx.tx.solarPlant.findMany({
      where: { deletedAt: null, status: 'active' },
      select: {
        id: true,
        name: true,
        colonia: true,
        client: { select: { name: true, tariffMxnPerKwh: true } },
        company: { select: { settings: true } },
      },
    });
    const ids = plants.map((p) => p.id);
    const [alerts, latest] = await Promise.all([
      ctx.tx.alert.findMany({
        where: { plantId: { in: ids }, status: { in: [...OPEN_ALERT] } },
        orderBy: { detectedAt: 'desc' },
      }),
      latestPrediction(ctx, ids),
    ]);
    const rows = [];
    for (const p of plants) {
      const own = alerts.filter((a) => a.plantId === p.id);
      const m = latest.get(p.id);
      const cleaningDue =
        m?.daysToCleaning !== null &&
        m?.daysToCleaning !== undefined &&
        m.daysToCleaning <= horizon_days;
      if (own.length === 0 && !cleaningDue) continue;
      const tariff =
        dec(p.client.tariffMxnPerKwh) ??
        parseCompanySettings(p.company.settings).defaults.tariff_mxn_per_kwh;
      // Pérdida: la de la alerta más grave; sin alerta, la del último día con desviación.
      const worst = [...own].sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
      )[0];
      let lossKwh: number | null = null;
      if (worst && worst.type !== 'cleaning_due_soon') {
        lossKwh = (await estimateAlertLoss(ctx.tx, worst))?.kwh_per_day ?? null;
      } else if (m) {
        const days = await ctx.tx.plantDailyMetric.findMany({
          where: { plantId: p.id, isValidDay: true, date: { lte: m.date } },
          orderBy: { date: 'desc' },
          take: 3,
          select: { expectedTempKwh: true, prTemp: true, prBaseline: true, isValidDay: true },
        });
        lossKwh = estimatedDailyLossKwh(
          'underperformance',
          days.map((d) => ({
            expectedTempKwh: d.expectedTempKwh.toNumber(),
            prTemp: dec(d.prTemp),
            prBaseline: dec(d.prBaseline),
            isValidDay: d.isValidDay,
          })),
        );
      }
      rows.push({
        plant_id: p.id,
        name: p.name,
        client: p.client.name,
        colonia: p.colonia,
        reasons: [
          ...own.map((a) => `${a.type} (${a.severity})`),
          ...(cleaningDue && !own.some((a) => a.type === 'cleaning_due_soon')
            ? ['lavado previsto']
            : []),
        ],
        worst_severity: worst?.severity ?? null,
        days_to_cleaning: m?.daysToCleaning ?? null,
        confidence: m?.predictionConfidence ?? null,
        deviation_pct: r1(dec(m?.deviationPct ?? null)),
        estimated_loss_kwh_per_day: r1(lossKwh),
        estimated_loss_mxn_per_day: r2(lossKwh === null ? null : lossKwh * tariff),
        alert_summary: worst ? summaryOf(worst.aiExplanation) : null,
      });
    }
    rows.sort(
      (a, b) =>
        (a.worst_severity ? SEVERITY_RANK[a.worst_severity] : 3) -
          (b.worst_severity ? SEVERITY_RANK[b.worst_severity] : 3) ||
        (a.days_to_cleaning ?? 999) - (b.days_to_cleaning ?? 999),
    );
    return {
      horizon_days,
      note: 'Pérdidas y días para el lavado son estimaciones.',
      plants: rows,
    };
  },
});

export const listAlerts = defineTool({
  name: 'list_alerts',
  description:
    'Alertas con planta, tipo, severidad, estado, fecha y resumen de su explicación. Sin estado: las abiertas (open y acknowledged). period filtra por fecha de detección.',
  input: z
    .object({
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional(),
      type: z.enum(ALERT_TYPES).optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      period: periodSchema.optional(),
      zone: zoneSchema.optional(),
      limit: limitSchema(20),
    })
    .strict(),
  run: async ({ status, type, severity, period, zone, limit }, ctx) => {
    const p = period ? resolvePeriod(period, ctx.today) : null;
    const where: Prisma.AlertWhereInput = {
      status: status ?? { in: [...OPEN_ALERT] },
      ...(type && { type }),
      ...(severity && { severity }),
      ...(p && {
        detectedAt: { gte: startOfPeriod(p.from, ctx), lt: startOfPeriod(p.to, ctx, 1) },
      }),
      plant: plantWhere(zone),
    };
    const [alerts, total] = await Promise.all([
      ctx.tx.alert.findMany({
        where,
        orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
        take: limit,
        include: { plant: { select: { id: true, name: true, colonia: true } } },
      }),
      ctx.tx.alert.count({ where }),
    ]);
    return {
      ...(p && { period: p.label }),
      total,
      alerts: alerts.map((a) => ({
        id: a.id,
        plant_id: a.plant.id,
        plant: a.plant.name,
        colonia: a.plant.colonia,
        type: a.type,
        severity: a.severity,
        status: a.status,
        detected_on: isoDay(a.detectedAt),
        summary: summaryOf(a.aiExplanation),
      })),
    };
  },
});

export const listTickets = defineTool({
  name: 'list_tickets',
  description:
    'Tickets de mantenimiento con planta, tipo, estado, técnico asignado y fechas. Sin estado: los abiertos (pending, scheduled, in_progress). period filtra por fecha de creación.',
  input: z
    .object({
      status: z.enum(['pending', 'scheduled', 'in_progress', 'resolved', 'cancelled']).optional(),
      type: z.enum(['cleaning', 'inspection', 'repair', 'other']).optional(),
      period: periodSchema.optional(),
      limit: limitSchema(20),
    })
    .strict(),
  run: async ({ status, type, period, limit }, ctx) => {
    const p = period ? resolvePeriod(period, ctx.today) : null;
    const where: Prisma.MaintenanceTicketWhereInput = {
      status: status ?? { in: ['pending', 'scheduled', 'in_progress'] },
      ...(type && { type }),
      ...(p && {
        createdAt: { gte: startOfPeriod(p.from, ctx), lt: startOfPeriod(p.to, ctx, 1) },
      }),
    };
    const [tickets, total, byAssignee] = await Promise.all([
      ctx.tx.maintenanceTicket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        include: {
          plant: { select: { id: true, name: true } },
          assignedTo: { select: { name: true } },
        },
      }),
      ctx.tx.maintenanceTicket.count({ where }),
      ctx.tx.maintenanceTicket.groupBy({ by: ['assignedToId'], where, _count: { _all: true } }),
    ]);
    const names = new Map(
      (
        await ctx.tx.user.findMany({
          where: {
            id: { in: byAssignee.flatMap((b) => (b.assignedToId ? [b.assignedToId] : [])) },
          },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return {
      ...(p && { period: p.label }),
      total,
      count_by_assignee: byAssignee
        .map((b) => ({
          assigned_to: b.assignedToId ? (names.get(b.assignedToId) ?? null) : null,
          tickets: b._count._all,
        }))
        .sort((a, b) => b.tickets - a.tickets),
      tickets: tickets.map((t) => ({
        plant_id: t.plant.id,
        plant: t.plant.name,
        type: t.type,
        status: t.status,
        priority: t.priority,
        title: t.title,
        assigned_to: t.assignedTo?.name ?? null,
        created_on: isoDay(t.createdAt),
        scheduled_for: t.scheduledFor ? isoDay(t.scheduledFor) : null,
        resolved_on: t.resolvedAt ? isoDay(t.resolvedAt) : null,
      })),
    };
  },
});

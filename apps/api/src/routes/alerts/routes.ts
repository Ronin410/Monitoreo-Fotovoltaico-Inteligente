import { withTenant, type Alert, type Prisma, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import type { z } from 'zod';
import { requirePermission, companyAuthOf } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import { ticketResponse, ticketFromAlertBody } from '../tickets/schemas.js';
import { createTicket, ticketDto, ticketInclude } from '../tickets/service.js';
import type { alertSummary } from './schemas.js';
import { alertDetail, alertsQuery, alertsResponse, dismissAlertBody } from './schemas.js';

// Alertas (F5-T3, specs/06 §4): bandeja, detalle, reconocer, descartar con motivo y crear ticket.
// Las abre y resuelve el job alerts.evaluate; aquí solo cambian por acción de una persona.

const OPEN_STATUSES = ['open', 'acknowledged'] as const;
const alertNotFound = () => new HttpError(404, 'NOT_FOUND', 'Alerta no encontrada');
const alertClosed = () => new HttpError(409, 'ALERT_CLOSED', 'La alerta ya no está abierta');

const withPlant = {
  plant: {
    select: {
      id: true,
      name: true,
      colonia: true,
      postalCode: true,
      client: { select: { name: true } },
    },
  },
} as const satisfies Prisma.AlertInclude;
type AlertWithPlant = Prisma.AlertGetPayload<{ include: typeof withPlant }>;

function summaryDto(a: AlertWithPlant): z.input<typeof alertSummary> {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    status: a.status,
    detected_at: a.detectedAt,
    resolved_at: a.resolvedAt,
    resolution: a.resolution,
    ai_status: a.aiStatus,
    ticket_id: a.ticketId,
    plant: {
      id: a.plant.id,
      name: a.plant.name,
      colonia: a.plant.colonia,
      postal_code: a.plant.postalCode,
      client_name: a.plant.client.name,
    },
  };
}

const asObject = (v: Prisma.JsonValue | null) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function detailDto(a: AlertWithPlant): z.input<typeof alertDetail> {
  return {
    ...summaryDto(a),
    dismiss_reason: a.dismissReason,
    evidence: asObject(a.evidence) ?? {},
    ai_explanation: asObject(a.aiExplanation),
  };
}

/** Datos con que se prellena el ticket de una alerta (specs/06 §5). */
function ticketDefaults(alert: Alert, plantName: string) {
  const evidence = asObject(alert.evidence) ?? {};
  const trigger = asObject((evidence.trigger ?? null) as Prisma.JsonValue);
  const deviations = (trigger?.deviation_pct as (number | null)[] | undefined) ?? [];
  const lastDeviation = deviations.at(-1);
  const below =
    typeof lastDeviation === 'number'
      ? ` Rinde ${lastDeviation.toFixed(1)} % por debajo de su normal.`
      : '';
  const summary = asObject(alert.aiExplanation)?.summary;
  const ai = typeof summary === 'string' ? ` ${summary}` : '';
  switch (alert.type) {
    case 'soiling':
      return {
        type: 'cleaning' as const,
        title: `Lavado de paneles — ${plantName}`,
        description: `Posible suciedad.${below}${ai}`,
      };
    case 'cleaning_due_soon':
      return {
        type: 'cleaning' as const,
        title: `Lavado preventivo — ${plantName}`,
        description: `Se acerca al umbral de suciedad.${below}${ai}`,
      };
    case 'sudden_drop':
      return {
        type: 'inspection' as const,
        title: `Revisión por caída de producción — ${plantName}`,
        description: `Caída brusca de producción; revisar inversor y strings.${below}${ai}`,
      };
    case 'offline':
      return {
        type: 'inspection' as const,
        title: `Revisión: planta sin datos — ${plantName}`,
        description: `El inversor dejó de reportar; revisar energía, comunicación e internet.${ai}`,
      };
  }
}

const PRIORITY = { critical: 'high', warning: 'normal', info: 'low' } as const;

export function alertsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(requirePermission('fleet:read'));
  const manage = requirePermission('alerts:manage');

  router.get('/', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const query = alertsQuery.parse(req.query);
    const where: Prisma.AlertWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.open === true ? { status: { in: [...OPEN_STATUSES] } } : {}),
      ...(query.open === false ? { status: { notIn: [...OPEN_STATUSES] } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.plant_id ? { plantId: query.plant_id } : {}),
      ...(query.postal_code ? { plant: { postalCode: query.postal_code } } : {}),
    };
    const [alerts, total] = await withTenant(db, companyId, (tx) =>
      Promise.all([
        tx.alert.findMany({
          where,
          include: withPlant,
          orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(query),
        }),
        tx.alert.count({ where }),
      ]),
    );
    respond(res, alertsResponse, paginated(alerts.map(summaryDto), query, total));
  });

  router.get('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const alert = await withTenant(db, companyId, (tx) =>
      tx.alert.findFirst({ where: { id }, include: withPlant }),
    );
    if (!alert) throw alertNotFound();
    respond(res, alertDetail, detailDto(alert));
  });

  router.post('/:id/acknowledge', manage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const alert = await withTenant(db, companyId, async (tx) => {
      const current = await tx.alert.findFirst({ where: { id } });
      if (!current) throw alertNotFound();
      if (current.status === 'acknowledged')
        return tx.alert.findUniqueOrThrow({ where: { id }, include: withPlant });
      if (current.status !== 'open') throw alertClosed();
      return tx.alert.update({
        where: { id },
        data: { status: 'acknowledged' },
        include: withPlant,
      });
    });
    respond(res, alertDetail, detailDto(alert));
  });

  router.post('/:id/dismiss', manage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const { reason } = dismissAlertBody.parse(req.body);
    const alert = await withTenant(db, companyId, async (tx) => {
      const current = await tx.alert.findFirst({ where: { id } });
      if (!current) throw alertNotFound();
      if (!(OPEN_STATUSES as readonly string[]).includes(current.status)) throw alertClosed();
      return tx.alert.update({
        where: { id },
        data: { status: 'dismissed', dismissReason: reason },
        include: withPlant,
      });
    });
    respond(res, alertDetail, detailDto(alert));
  });

  router.post('/:id/ticket', manage, async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const body = ticketFromAlertBody.parse(req.body ?? {});
    const ticket = await withTenant(db, auth.companyId, async (tx) => {
      const alert = await tx.alert.findFirst({
        where: { id },
        include: { plant: { select: { name: true } }, ticket: { select: { status: true } } },
      });
      if (!alert) throw alertNotFound();
      if (!(OPEN_STATUSES as readonly string[]).includes(alert.status)) throw alertClosed();
      if (alert.ticket && ['pending', 'scheduled', 'in_progress'].includes(alert.ticket.status)) {
        throw new HttpError(409, 'TICKET_EXISTS', 'La alerta ya tiene un ticket abierto', {
          ticket_id: alert.ticketId,
        });
      }
      const defaults = ticketDefaults(alert, alert.plant.name);
      const created = await createTicket(tx, auth.companyId, auth.userId, {
        plantId: alert.plantId,
        alertId: alert.id,
        type: defaults.type,
        priority: body.priority ?? PRIORITY[alert.severity],
        title: body.title ?? defaults.title,
        description: body.description === undefined ? defaults.description : body.description,
        assignedTo: body.assigned_to,
        scheduledFor: body.scheduled_for,
      });
      // Crear el ticket implica que alguien ya la vio.
      await tx.alert.update({
        where: { id },
        data: { ticketId: created.id, ...(alert.status === 'open' && { status: 'acknowledged' }) },
      });
      return tx.maintenanceTicket.findUniqueOrThrow({
        where: { id: created.id },
        include: ticketInclude,
      });
    });
    respond(res, ticketResponse, ticketDto(ticket), 201);
  });

  return router;
}

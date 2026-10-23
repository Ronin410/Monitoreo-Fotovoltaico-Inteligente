import type { JobEnqueuer } from '@pv/adapters';
import { can } from '@pv/core';
import { withTenant, type Prisma, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  createTicketBody,
  patchTicketBody,
  TECHNICIAN_FIELDS,
  assigneesResponse,
  ticketResponse,
  ticketsQuery,
  ticketsResponse,
} from './schemas.js';
import {
  assertAssignee,
  createTicket,
  enqueueEmail,
  queueAssignedEmail,
  ticketDto,
  ticketInclude,
  ticketNotFound,
} from './service.js';

// Tickets de mantenimiento (F5-T3, specs/06 §5). company_admin y operator ven y gestionan todos;
// el técnico solo ve y actualiza los asignados a él (los demás le responden 404).

const OPEN_STATUSES = ['pending', 'scheduled', 'in_progress'] as const;
const forbidden = (message: string) => new HttpError(403, 'FORBIDDEN', message);

export function ticketsRouter(db: PrismaClient, now: () => Date, jobs: JobEnqueuer): Router {
  const router = Router();
  router.use(requirePermission('tickets:update'));

  /** Restricción por rol: el técnico solo alcanza sus tickets. */
  const scopeOf = (auth: ReturnType<typeof companyAuthOf>): Prisma.MaintenanceTicketWhereInput =>
    can(auth.role, 'alerts:manage') ? {} : { assignedToId: auth.userId };

  router.get('/', async (req, res) => {
    const auth = companyAuthOf(req);
    const query = ticketsQuery.parse(req.query);
    const filters: Prisma.MaintenanceTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.open === true ? { status: { in: [...OPEN_STATUSES] } } : {}),
      ...(query.open === false ? { status: { notIn: [...OPEN_STATUSES] } } : {}),
      ...(query.plant_id ? { plantId: query.plant_id } : {}),
      ...(query.assigned_to ? { assignedToId: query.assigned_to } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    // AND: los filtros del técnico se combinan con su restricción, no la reemplazan.
    const where = { AND: [filters, scopeOf(auth)] };
    const [tickets, total] = await withTenant(db, auth.companyId, (tx) =>
      Promise.all([
        tx.maintenanceTicket.findMany({
          where,
          include: ticketInclude,
          // Primero lo más urgente y lo programado más pronto.
          orderBy: [
            { priority: 'desc' },
            { scheduledFor: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          ...pageArgs(query),
        }),
        tx.maintenanceTicket.count({ where }),
      ]),
    );
    respond(res, ticketsResponse, paginated(tickets.map(ticketDto), query, total));
  });

  router.post('/', requirePermission('alerts:manage'), async (req, res) => {
    const auth = companyAuthOf(req);
    const body = createTicketBody.parse(req.body);
    const { ticket, email } = await withTenant(db, auth.companyId, async (tx) => {
      const plant = await tx.solarPlant.findFirst({
        where: { id: body.plant_id, deletedAt: null },
        select: { id: true },
      });
      if (!plant) throw new HttpError(400, 'INVALID_PLANT', 'La planta no existe o fue eliminada');
      const created = await createTicket(tx, auth.companyId, auth.userId, {
        plantId: plant.id,
        type: body.type,
        priority: body.priority,
        title: body.title,
        description: body.description,
        assignedTo: body.assigned_to,
        scheduledFor: body.scheduled_for,
      });
      return { ticket: created, email: await queueAssignedEmail(tx, created) };
    });
    await enqueueEmail(jobs, req.log, auth.companyId, email);
    respond(res, ticketResponse, ticketDto(ticket), 201);
  });

  /** Posibles responsables: el operador los necesita y no puede listar usuarios (specs/02). */
  router.get('/assignees', requirePermission('alerts:manage'), async (req, res) => {
    const auth = companyAuthOf(req);
    const users = await withTenant(db, auth.companyId, (tx) =>
      tx.user.findMany({
        where: { status: 'active', role: { in: ['technician', 'operator', 'company_admin'] } },
        select: { id: true, name: true, role: true },
        orderBy: [{ role: 'desc' }, { name: 'asc' }],
      }),
    );
    // El filtro de la consulta deja solo roles de empresa; respond lo vuelve a validar.
    const data = users.map((u) => ({ ...u, role: u.role as Exclude<typeof u.role, 'superadmin'> }));
    respond(res, assigneesResponse, { data });
  });

  router.get('/:id', async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const ticket = await withTenant(db, auth.companyId, (tx) =>
      tx.maintenanceTicket.findFirst({ where: { id, ...scopeOf(auth) }, include: ticketInclude }),
    );
    if (!ticket) throw ticketNotFound();
    respond(res, ticketResponse, ticketDto(ticket));
  });

  router.patch('/:id', async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const body = patchTicketBody.parse(req.body);
    const manager = can(auth.role, 'alerts:manage');
    if (!manager) {
      const extra = Object.keys(body).filter(
        (k) => !(TECHNICIAN_FIELDS as readonly string[]).includes(k),
      );
      if (extra.length > 0) {
        throw forbidden(`El técnico solo puede cambiar el estado, las notas y la limpieza`);
      }
      if (body.status === 'cancelled') throw forbidden('El técnico no puede cancelar tickets');
    }

    const { ticket, email } = await withTenant(db, auth.companyId, async (tx) => {
      const current = await tx.maintenanceTicket.findFirst({ where: { id, ...scopeOf(auth) } });
      if (!current) throw ticketNotFound();
      if (current.status === 'resolved' || current.status === 'cancelled') {
        throw new HttpError(409, 'TICKET_CLOSED', 'El ticket ya está cerrado');
      }
      await assertAssignee(tx, body.assigned_to);

      const resolving = body.status === 'resolved';
      const resolvedAt = resolving ? now() : undefined;
      const cleaningPerformed = body.cleaning_performed ?? current.cleaningPerformed;
      await tx.maintenanceTicket.update({
        where: { id },
        data: {
          status: body.status,
          resolutionNotes: body.resolution_notes,
          cleaningPerformed: body.cleaning_performed,
          priority: body.priority,
          title: body.title,
          description: body.description,
          type: body.type,
          assignedToId: body.assigned_to,
          scheduledFor:
            body.scheduled_for === undefined
              ? undefined
              : body.scheduled_for && new Date(`${body.scheduled_for}T00:00:00Z`),
          resolvedAt,
        },
      });
      // Resolver con limpieza registra el evento `cleaning`: reinicia la tendencia de suciedad y
      // permite que la alerta se resuelva sola si los datos lo confirman (specs/06 §5).
      if (resolving && cleaningPerformed) {
        await tx.plantEvent.create({
          data: {
            companyId: auth.companyId,
            plantId: current.plantId,
            type: 'cleaning',
            source: 'ticket',
            occurredAt: resolvedAt as Date,
            ticketId: current.id,
            notes: body.resolution_notes ?? current.resolutionNotes,
          },
        });
      }
      const updated = await tx.maintenanceTicket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
      // Nuevo responsable: se le avisa por correo (specs/06 §6).
      const reassigned = body.assigned_to && body.assigned_to !== current.assignedToId;
      return { ticket: updated, email: reassigned ? await queueAssignedEmail(tx, updated) : null };
    });
    await enqueueEmail(jobs, req.log, auth.companyId, email);
    respond(res, ticketResponse, ticketDto(ticket));
  });

  return router;
}

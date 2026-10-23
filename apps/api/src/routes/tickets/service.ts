import type { Prisma, TenantDb } from '@pv/db';
import type { z } from 'zod';
import { dec } from '../../http/decimal.js';
import { HttpError } from '../../http/errors.js';
import type { ticketResponse } from './schemas.js';

// Lógica compartida de tickets: la usan /tickets y /alerts/:id/ticket.

export const ticketInclude = {
  plant: {
    select: {
      id: true,
      name: true,
      capacityKwp: true,
      colonia: true,
      postalCode: true,
      lat: true,
      lon: true,
      client: {
        select: { id: true, name: true, contactName: true, phone: true, address: true },
      },
    },
  },
  alert: { select: { id: true, type: true, severity: true, status: true, detectedAt: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const satisfies Prisma.MaintenanceTicketInclude;

export type TicketWithRelations = Prisma.MaintenanceTicketGetPayload<{
  include: typeof ticketInclude;
}>;

export const ticketNotFound = () => new HttpError(404, 'NOT_FOUND', 'Ticket no encontrado');

export function ticketDto(t: TicketWithRelations): z.input<typeof ticketResponse> {
  const p = t.plant;
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    priority: t.priority,
    title: t.title,
    description: t.description,
    scheduled_for: t.scheduledFor ? t.scheduledFor.toISOString().slice(0, 10) : null,
    resolved_at: t.resolvedAt,
    resolution_notes: t.resolutionNotes,
    cleaning_performed: t.cleaningPerformed,
    assigned_to: t.assignedTo,
    created_by: t.createdBy,
    plant: {
      id: p.id,
      name: p.name,
      capacity_kwp: Number(p.capacityKwp),
      colonia: p.colonia,
      postal_code: p.postalCode,
      lat: dec(p.lat),
      lon: dec(p.lon),
      client: {
        id: p.client.id,
        name: p.client.name,
        contact_name: p.client.contactName,
        phone: p.client.phone,
        address: p.client.address,
      },
    },
    alert: t.alert && {
      id: t.alert.id,
      type: t.alert.type,
      severity: t.alert.severity,
      status: t.alert.status,
      detected_at: t.alert.detectedAt,
    },
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/** El responsable debe ser un usuario activo de la empresa (RLS limita la búsqueda a ella). */
export async function assertAssignee(tx: TenantDb, userId: string | null | undefined) {
  if (!userId) return;
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      status: 'active',
      role: { in: ['technician', 'operator', 'company_admin'] },
    },
    select: { id: true },
  });
  if (!user) {
    throw new HttpError(400, 'INVALID_ASSIGNEE', 'El responsable no existe o no está activo');
  }
}

export type NewTicket = {
  plantId: string;
  alertId?: string;
  type: TicketWithRelations['type'];
  priority?: TicketWithRelations['priority'];
  title: string;
  description?: string | null;
  assignedTo?: string | null;
  scheduledFor?: string | null;
};

export async function createTicket(
  tx: TenantDb,
  companyId: string,
  createdById: string,
  t: NewTicket,
): Promise<TicketWithRelations> {
  await assertAssignee(tx, t.assignedTo);
  const ticket = await tx.maintenanceTicket.create({
    data: {
      companyId,
      plantId: t.plantId,
      alertId: t.alertId ?? null,
      type: t.type,
      priority: t.priority ?? 'normal',
      title: t.title,
      description: t.description ?? null,
      assignedToId: t.assignedTo ?? null,
      scheduledFor: t.scheduledFor ? new Date(`${t.scheduledFor}T00:00:00Z`) : null,
      status: t.scheduledFor ? 'scheduled' : 'pending',
      createdById,
    },
    include: ticketInclude,
  });
  // TODO(F5-T4): con responsable, encolar notifications.send "Ticket asignado" (specs/06 §6).
  return ticket;
}

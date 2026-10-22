import type { Prisma } from '@pv/db';

// Auditoría de acciones sensibles (specs/02 §Otros controles): login, cambios de usuarios y
// roles, credenciales, umbrales, eliminación de plantas y envío de reportes. Cada registro se
// escribe en la misma transacción que el cambio que describe.
// La metadata nunca incluye contraseñas, tokens ni credenciales.

export const AUDIT_ACTIONS = [
  // Autenticación
  'auth.login',
  'auth.login_failed',
  'auth.password_reset',
  // Usuarios y roles
  'user.invited',
  'user.invitation_accepted',
  'user.updated',
  // Empresas (superadmin)
  'company.created',
  'company.updated',
  // Tareas futuras: F2-T3, F2-T4, F2-T2 y F9-T4.
  'plant.credentials_updated',
  'company.settings_updated',
  'plant.deleted',
  'report.sent',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  action: AuditAction;
  /** null solo para acciones de plataforma sin empresa (por ejemplo login con correo inexistente). */
  companyId: string | null;
  userId: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonObject;
  ip?: string | null;
};

/** Cualquier cliente o transacción de Prisma (pv_app dentro de withTenant, o pv_service). */
export type AuditWriter = {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown>;
  };
};

/** Registra la acción. Llamar con la misma transacción que hace el cambio. */
export async function recordAudit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      companyId: entry.companyId,
      userId: entry.userId,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    },
  });
}

/** Diferencias { campo: { from, to } } entre dos versiones, solo de los campos indicados. */
export function changesOf<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T & string)[],
): Prisma.InputJsonObject {
  const changes: Record<
    string,
    { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }
  > = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field] = {
        from: (before[field] ?? null) as Prisma.InputJsonValue | null,
        to: (after[field] ?? null) as Prisma.InputJsonValue | null,
      };
    }
  }
  return changes;
}

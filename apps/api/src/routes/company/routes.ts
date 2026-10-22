import { withTenant, type PrismaClient, type User } from '@pv/db';
import { Router } from 'express';
import { changesOf, recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { normalizeEmail, type AuthService } from '../../auth/service.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  companyUser,
  companyUsersResponse,
  invitationBody,
  invitationCreatedResponse,
  userPatchBody,
  usersQuery,
} from './schemas.js';

// Gestión de usuarios de la empresa (specs/02: solo company_admin; specs/10 §Empresa y usuarios).

const userNotFound = () => new HttpError(404, 'NOT_FOUND', 'Usuario no encontrado');

function userDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    last_login_at: u.lastLoginAt,
    created_at: u.createdAt,
  };
}

export function companyUsersRouter(db: PrismaClient, auth: AuthService): Router {
  const router = Router();
  const canManage = requirePermission('users:manage');

  router.get('/users', canManage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const page = usersQuery.parse(req.query);
    const [users, total] = await withTenant(db, companyId, (tx) =>
      Promise.all([
        tx.user.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(page) }),
        tx.user.count(),
      ]),
    );
    respond(res, companyUsersResponse, paginated(users.map(userDto), page, total));
  });

  router.post('/invitations', canManage, async (req, res) => {
    const session = companyAuthOf(req);
    const body = invitationBody.parse(req.body);
    const email = normalizeEmail(body.email);
    const invitation = await withTenant(db, session.companyId, async (tx) => {
      if (await tx.user.findFirst({ where: { email } })) {
        throw new HttpError(
          409,
          'USER_EXISTS',
          'Ese correo ya pertenece a un usuario de la empresa',
        );
      }
      const pending = await auth.createInvitation(tx, {
        companyId: session.companyId,
        email,
        role: body.role,
        invitedById: session.userId,
      });
      await recordAudit(tx, {
        action: 'user.invited',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'invitation',
        entityId: pending.id,
        metadata: { email, role: body.role },
        ip: req.ip ?? null,
      });
      return pending;
    });
    await invitation.send();
    respond(
      res,
      invitationCreatedResponse,
      { id: invitation.id, email, role: body.role, expires_at: invitation.expiresAt },
      201,
    );
  });

  router.patch('/users/:id', canManage, async (req, res) => {
    const session = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const body = userPatchBody.parse(req.body);
    if (id === session.userId) {
      throw new HttpError(
        400,
        'CANNOT_MODIFY_SELF',
        'No puedes cambiar tu propio rol ni desactivar tu cuenta',
      );
    }

    const updated = await withTenant(db, session.companyId, async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw userNotFound();

      const losesAdmin =
        target.role === 'company_admin' &&
        target.status === 'active' &&
        ((body.role !== undefined && body.role !== 'company_admin') || body.status === 'disabled');
      if (losesAdmin) {
        const otherAdmins = await tx.user.count({
          where: { role: 'company_admin', status: 'active', id: { not: id } },
        });
        if (otherAdmins === 0) {
          throw new HttpError(
            409,
            'LAST_ADMIN',
            'La empresa debe conservar un administrador activo',
          );
        }
      }
      const after = await tx.user.update({
        where: { id },
        data: {
          ...(body.role === undefined ? {} : { role: body.role }),
          ...(body.status === undefined ? {} : { status: body.status }),
        },
      });
      await recordAudit(tx, {
        action: 'user.updated',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'user',
        entityId: id,
        metadata: { changes: changesOf(target, after, ['role', 'status']) },
        ip: req.ip ?? null,
      });
      return after;
    });

    // Un usuario desactivado pierde sus sesiones de inmediato.
    if (updated.status === 'disabled') await auth.revokeAllSessions(updated.id);
    respond(res, companyUser, userDto(updated));
  });

  return router;
}

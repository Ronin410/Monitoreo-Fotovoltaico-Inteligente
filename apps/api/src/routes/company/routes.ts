import { localDate } from '@pv/core';
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
  aiUsageResponse,
  companyUser,
  companyUsersResponse,
  invitationBody,
  invitationCreatedResponse,
  pendingInvitationsResponse,
  userPatchBody,
  usersQuery,
} from './schemas.js';

// Gestión de usuarios de la empresa (specs/02: solo company_admin; specs/10 §Empresa y usuarios).

const FEATURES = ['chat', 'alert_explanation', 'report_narrative'] as const;

/** YYYY-MM desplazado `months` meses. */
function shiftPeriod(period: string, months: number): string {
  const [y = 0, m = 1] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

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

export function companyUsersRouter(db: PrismaClient, auth: AuthService, now: () => Date): Router {
  const router = Router();
  const canManage = requirePermission('users:manage');

  /** Invitaciones vigentes sin aceptar: aún no son usuarios. */
  router.get('/invitations', canManage, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const pending = await withTenant(db, companyId, (tx) =>
      tx.invitation.findMany({
        where: { acceptedAt: null, expiresAt: { gt: now() } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    // Las invitaciones de empresa nunca son de superadmin; respond lo vuelve a validar.
    const data = pending.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as Exclude<typeof i.role, 'superadmin'>,
      expires_at: i.expiresAt,
      created_at: i.createdAt,
    }));
    respond(res, pendingInvitationsResponse, { data });
  });

  router.get('/ai-usage', requirePermission('company:configure'), async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { company, usage, period } = await withTenant(db, companyId, async (tx) => {
      const c = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const current = localDate(now(), c.timezone).slice(0, 7);
      const rows = await tx.aiUsageMonthly.findMany({
        where: { period: { gte: shiftPeriod(current, -6), lte: current } },
      });
      return { company: c, usage: rows, period: current };
    });
    const tokens = (r: { inputTokens: bigint; outputTokens: bigint }) =>
      Number(r.inputTokens + r.outputTokens);
    const current = usage.filter((u) => u.period === period);
    respond(res, aiUsageResponse, {
      period,
      budget_tokens: company.aiMonthlyTokenBudget,
      used_tokens: current.reduce((s, u) => s + tokens(u), 0),
      by_feature: FEATURES.map((feature) => {
        const row = current.find((u) => u.feature === feature);
        return {
          feature,
          input_tokens: Number(row?.inputTokens ?? 0n),
          output_tokens: Number(row?.outputTokens ?? 0n),
          requests: row?.requests ?? 0,
        };
      }),
      history: [-6, -5, -4, -3, -2, -1].map((offset) => {
        const p = shiftPeriod(period, offset);
        return {
          period: p,
          tokens: usage.filter((u) => u.period === p).reduce((s, u) => s + tokens(u), 0),
        };
      }),
    });
  });

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

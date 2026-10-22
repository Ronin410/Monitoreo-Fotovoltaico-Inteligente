import type { EmailProvider } from '@pv/adapters';
import type { Env } from '@pv/config';
import type { PrismaClient, TenantDb, UserRole } from '@pv/db';
import { HttpError } from '../http/errors.js';
import { invitationEmail, passwordResetEmail } from './emails.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  type AuthContext,
} from './tokens.js';

// Autenticación (specs/02 §Autenticación). Todo ocurre antes de conocer la empresa de la
// sesión, por eso usa la conexión de plataforma (pv_service), salvo crear invitaciones, que
// lo hace un company_admin dentro de su empresa.

const DAY_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY_MS;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const INVITATION_TTL_MS = 7 * DAY_MS;

export type AuthServiceDeps = {
  env: Pick<Env, 'JWT_SECRET' | 'REFRESH_TOKEN_SECRET' | 'APP_URL'>;
  serviceDb: PrismaClient;
  email: EmailProvider;
  now: () => Date;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string | null;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
};

export type InvitationRole = Exclude<UserRole, 'superadmin'>;

export type NewInvitationInput = {
  companyId: string;
  email: string;
  role: InvitationRole;
  invitedById: string | null;
};

export type PendingInvitation = {
  id: string;
  email: string;
  expiresAt: Date;
  /** Envía el correo de invitación; llamar después de confirmar la transacción. */
  send: () => Promise<void>;
};

/** Mensaje único para no revelar si el correo existe, la cuenta está desactivada, etc. */
const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
const invalidSession = () => new HttpError(401, 'INVALID_SESSION', 'La sesión no es válida');
const invalidInvitation = () =>
  new HttpError(404, 'INVITATION_NOT_FOUND', 'La invitación no es válida o ya expiró');
const invalidResetToken = () =>
  new HttpError(400, 'INVALID_TOKEN', 'El enlace no es válido o ya expiró');

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

type UserWithCompany = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  companyId: string | null;
  company: { status: string } | null;
};

/** Un usuario puede tener sesión si está activo y su empresa no está suspendida. */
function canHaveSession(user: UserWithCompany): boolean {
  if (user.status !== 'active') return false;
  if (user.role === 'superadmin') return user.companyId === null;
  return user.company?.status === 'active';
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private hash(token: string): string {
    return hashOpaqueToken(this.deps.env.REFRESH_TOKEN_SECRET, token);
  }

  private async issueSession(user: UserWithCompany): Promise<Session> {
    const now = this.deps.now();
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    await this.deps.serviceDb.$transaction([
      this.deps.serviceDb.refreshToken.create({
        data: { userId: user.id, tokenHash: this.hash(refreshToken), expiresAt: refreshExpiresAt },
      }),
      this.deps.serviceDb.user.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
    ]);
    const ctx: AuthContext = { userId: user.id, companyId: user.companyId, role: user.role };
    return {
      accessToken: await signAccessToken(this.deps.env.JWT_SECRET, ctx, now),
      refreshToken,
      refreshExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
    };
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.deps.serviceDb.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { company: { select: { status: true } } },
    });
    // Siempre se verifica (contra un hash ficticio si no hay usuario) para igualar tiempos.
    const passwordOk = await verifyPassword(user?.passwordHash ?? null, password);
    if (!user || !passwordOk || !canHaveSession(user)) throw invalidCredentials();
    return this.issueSession(user);
  }

  /** Rota el refresh token. Reusar uno ya rotado revoca todas las sesiones del usuario. */
  async refresh(refreshToken: string): Promise<Session> {
    const db = this.deps.serviceDb;
    const now = this.deps.now();
    const row = await db.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
      include: { user: { include: { company: { select: { status: true } } } } },
    });
    if (!row) throw invalidSession();

    if (row.revokedAt) {
      // Posible robo del token: se cierran todas las sesiones del usuario.
      await this.revokeAllSessions(row.userId);
      throw invalidSession();
    }
    if (row.expiresAt <= now || !canHaveSession(row.user)) {
      await db.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      throw invalidSession();
    }

    // Revocación condicional: si dos peticiones usan el mismo token a la vez, solo una gana.
    const { count } = await db.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count === 0) {
      await this.revokeAllSessions(row.userId);
      throw invalidSession();
    }
    const session = await this.issueSession(row.user);
    await db.refreshToken.update({
      where: { id: row.id },
      data: { replacedBy: { connect: { tokenHash: this.hash(session.refreshToken) } } },
    });
    return session;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.deps.serviceDb.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: this.deps.now() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.deps.serviceDb.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.deps.now() },
    });
  }

  /** Envía el enlace de recuperación si la cuenta existe y está activa. Nunca revela si existe. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.deps.serviceDb.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { company: { select: { status: true } } },
    });
    if (!user || !canHaveSession(user)) return;

    const token = generateOpaqueToken();
    await this.deps.serviceDb.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(token),
        expiresAt: new Date(this.deps.now().getTime() + PASSWORD_RESET_TTL_MS),
      },
    });
    const link = `${this.deps.env.APP_URL}/restablecer-contrasena/${token}`;
    await this.deps.email.send(passwordResetEmail({ to: user.email, name: user.name, link }));
  }

  /** Cambia la contraseña con un token de un solo uso y cierra todas las sesiones. */
  async resetPassword(token: string, password: string): Promise<void> {
    const db = this.deps.serviceDb;
    const now = this.deps.now();
    const row = await db.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: { include: { company: { select: { status: true } } } } },
    });
    if (!row || row.usedAt || row.expiresAt <= now || !canHaveSession(row.user)) {
      throw invalidResetToken();
    }
    const passwordHash = await hashPassword(password);
    await db.$transaction(async (tx) => {
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) throw invalidResetToken();
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  /**
   * Datos de una invitación nueva. El token en claro solo vive en memoria para el correo; en la
   * base se guarda su HMAC.
   */
  newInvitation(input: NewInvitationInput): {
    data: NewInvitationInput & { tokenHash: string; expiresAt: Date };
    send: (companyName: string) => Promise<void>;
  } {
    const token = generateOpaqueToken();
    const email = normalizeEmail(input.email);
    const link = `${this.deps.env.APP_URL}/invitacion/${token}`;
    return {
      data: {
        ...input,
        email,
        tokenHash: this.hash(token),
        expiresAt: new Date(this.deps.now().getTime() + INVITATION_TTL_MS),
      },
      send: (companyName) =>
        this.deps.email.send(invitationEmail({ to: email, companyName, role: input.role, link })),
    };
  }

  /**
   * Crea una invitación dentro de la empresa de la sesión (company_admin). Devuelve `send`,
   * que el llamador ejecuta después de confirmar la transacción para no enviar enlaces a
   * invitaciones que no se guardaron.
   */
  async createInvitation(tx: TenantDb, input: NewInvitationInput): Promise<PendingInvitation> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
    const { data, send } = this.newInvitation(input);
    const invitation = await tx.invitation.create({ data });
    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      send: () => send(company.name),
    };
  }

  private async findValidInvitation(token: string) {
    const invitation = await this.deps.serviceDb.invitation.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { company: { select: { name: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt <= this.deps.now() ||
      invitation.company.status !== 'active'
    ) {
      throw invalidInvitation();
    }
    return invitation;
  }

  async getInvitation(token: string) {
    const invitation = await this.findValidInvitation(token);
    return { email: invitation.email, role: invitation.role, companyName: invitation.company.name };
  }

  /** Acepta la invitación: crea el usuario activo con su contraseña e inicia sesión. */
  async acceptInvitation(token: string, name: string, password: string): Promise<Session> {
    const invitation = await this.findValidInvitation(token);
    const passwordHash = await hashPassword(password);
    const now = this.deps.now();

    const user = await this.deps.serviceDb.$transaction(async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: now },
      });
      if (count === 0) throw invalidInvitation();
      const existing = await tx.user.findUnique({ where: { email: invitation.email } });
      if (existing) {
        throw new HttpError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con este correo');
      }
      return tx.user.create({
        data: {
          companyId: invitation.companyId,
          email: invitation.email,
          name: name.trim(),
          role: invitation.role,
          status: 'active',
          passwordHash,
        },
        include: { company: { select: { status: true } } },
      });
    });
    return this.issueSession(user);
  }
}

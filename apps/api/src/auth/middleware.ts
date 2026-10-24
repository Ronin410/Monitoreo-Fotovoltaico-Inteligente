import type { PrismaClient } from '@pv/db';
import type { RequestHandler } from 'express';
import { HttpError } from '../http/errors.js';
import { verifyAccessToken, type AuthContext } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Usuario autenticado; lo fija requireAuth a partir del JWT (specs/02 §Capa 1). */
      auth?: AuthContext;
    }
  }
}

const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');

/**
 * Exige un access token válido en `Authorization: Bearer <token>` y, en cada petición, que el
 * usuario y su empresa sigan activos (specs/PREGUNTAS.md #23 y #37): desactivar a alguien o
 * suspender una empresa corta el acceso de inmediato, sin esperar a que venza el token. El rol y
 * la empresa salen de la base, así un cambio de rol también aplica en la siguiente petición.
 */
export function requireAuth(
  secret: string,
  now: () => Date,
  serviceDb: PrismaClient,
): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer (\S+)$/i.exec(header);
    const token = match?.[1] ? await verifyAccessToken(secret, match[1], now()) : null;
    if (!token) throw unauthenticated();
    const user = await serviceDb.user.findUnique({
      where: { id: token.userId },
      select: { status: true, role: true, companyId: true, company: { select: { status: true } } },
    });
    if (
      !user ||
      user.status !== 'active' ||
      user.companyId !== token.companyId ||
      (user.company && user.company.status !== 'active')
    ) {
      throw unauthenticated();
    }
    req.auth = { userId: token.userId, companyId: user.companyId, role: user.role };
    next();
  };
}

/** Devuelve el contexto de autenticación; solo para rutas detrás de requireAuth. */
export function authOf(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
  return req.auth;
}

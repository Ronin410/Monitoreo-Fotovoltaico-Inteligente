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

/** Exige un access token válido en `Authorization: Bearer <token>`. */
export function requireAuth(secret: string, now: () => Date): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer (\S+)$/i.exec(header);
    const auth = match?.[1] ? await verifyAccessToken(secret, match[1], now()) : null;
    if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
    req.auth = auth;
    next();
  };
}

/** Devuelve el contexto de autenticación; solo para rutas detrás de requireAuth. */
export function authOf(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
  return req.auth;
}

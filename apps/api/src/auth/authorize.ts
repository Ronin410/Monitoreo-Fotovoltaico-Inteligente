import { can, type Permission } from '@pv/core';
import type { RequestHandler } from 'express';
import { HttpError } from '../http/errors.js';
import { authOf } from './middleware.js';
import type { AuthContext } from './tokens.js';

const forbidden = () =>
  new HttpError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción');

/**
 * Exige que el rol de la sesión tenga el permiso (matriz de specs/02). Va después de
 * requireAuth. Un recurso de otra empresa no llega aquí: responde 404 en la ruta.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!can(authOf(req).role, permission)) throw forbidden();
    next();
  };
}

export type CompanyAuthContext = AuthContext & { companyId: string };

/**
 * Contexto de una ruta de empresa: el companyId sale siempre de la sesión (nunca del body,
 * query o params). El superadmin no pertenece a ninguna empresa y no puede usarlas.
 */
export function companyAuthOf(req: { auth?: AuthContext }): CompanyAuthContext {
  const auth = authOf(req);
  if (auth.companyId === null) throw forbidden();
  return { ...auth, companyId: auth.companyId };
}

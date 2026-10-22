import { createHmac, randomBytes } from 'node:crypto';
import { USER_ROLES } from '@pv/core';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

// Access token: JWT de 15 minutos (specs/02). Refresh, invitación y recuperación: tokens
// opacos aleatorios que se guardan solo como HMAC (nunca en claro).

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = 'pv-iot';
const AUDIENCE = 'pv-api';

export type AuthContext = {
  userId: string;
  /** null solo para superadmin. */
  companyId: string | null;
  role: (typeof USER_ROLES)[number];
};

const claimsSchema = z.object({
  sub: z.uuid(),
  cid: z.uuid().nullable(),
  role: z.enum(USER_ROLES),
});

const encoder = new TextEncoder();

export async function signAccessToken(
  secret: string,
  ctx: AuthContext,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ cid: ctx.companyId, role: ctx.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(ctx.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

/** Verifica firma, emisor, audiencia y expiración. Devuelve null si el token no es válido. */
export async function verifyAccessToken(
  secret: string,
  token: string,
  now: Date,
): Promise<AuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      currentDate: now,
    });
    const claims = claimsSchema.parse(payload);
    return { userId: claims.sub, companyId: claims.cid, role: claims.role };
  } catch {
    return null;
  }
}

/** Token opaco de 256 bits, apto para URL. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** HMAC-SHA256 del token; es lo único que se guarda en la base de datos. */
export function hashOpaqueToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

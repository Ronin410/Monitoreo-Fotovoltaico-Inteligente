import { Router, type CookieOptions, type Request, type Response } from 'express';
import { FixedWindowRateLimiter } from '../../auth/rate-limit.js';
import { normalizeEmail, type AuthService, type Session } from '../../auth/service.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../auth/tokens.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import {
  acceptBody,
  forgotBody,
  forgotResponse,
  invitationResponse,
  loginBody,
  resetBody,
  sessionResponse,
  tokenParam,
} from './schemas.js';

export const REFRESH_COOKIE = 'pv_refresh';
// La cookie solo viaja a las rutas de auth.
const REFRESH_COOKIE_PATH = '/api/auth';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: REFRESH_COOKIE_PATH,
};

function sendSession(res: Response, session: Session): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions,
    expires: session.refreshExpiresAt,
  });
  respond(res, sessionResponse, {
    access_token: session.accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      company_id: session.user.companyId,
    },
  });
}

function refreshCookieOf(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
}

/** Aplica el límite por IP y por correo (specs/02: 5 intentos por minuto). */
function enforceLimits(limiter: FixedWindowRateLimiter, res: Response, keys: string[]): void {
  const retryAfter = Math.max(...keys.map((k) => limiter.hit(k)));
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera un momento.');
  }
}

export function authRouter(auth: AuthService, now: () => Date): Router {
  const router = Router();
  const clock = () => now().getTime();
  const loginLimiter = new FixedWindowRateLimiter(5, 60_000, clock);
  const forgotLimiter = new FixedWindowRateLimiter(5, 60_000, clock);

  router.post('/login', async (req, res) => {
    const body = loginBody.parse(req.body);
    enforceLimits(loginLimiter, res, [`ip:${req.ip}`, `email:${normalizeEmail(body.email)}`]);
    sendSession(res, await auth.login(body.email, body.password, req.ip ?? null));
  });

  router.post('/refresh', async (req, res) => {
    const token = refreshCookieOf(req);
    try {
      if (!token) throw new HttpError(401, 'INVALID_SESSION', 'La sesión no es válida');
      sendSession(res, await auth.refresh(token));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw err;
    }
  });

  router.post('/logout', async (req, res) => {
    const token = refreshCookieOf(req);
    if (token) await auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  });

  // Siempre responde 200 para no revelar si el correo existe.
  router.post('/forgot-password', async (req, res) => {
    const body = forgotBody.parse(req.body);
    enforceLimits(forgotLimiter, res, [`ip:${req.ip}`, `email:${normalizeEmail(body.email)}`]);
    await auth.forgotPassword(body.email);
    respond(res, forgotResponse, { ok: true });
  });

  router.post('/reset-password', async (req, res) => {
    const body = resetBody.parse(req.body);
    await auth.resetPassword(body.token, body.password, req.ip ?? null);
    res.status(204).end();
  });

  router.get('/invitations/:token', async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    const invitation = await auth.getInvitation(token);
    respond(res, invitationResponse, {
      email: invitation.email,
      role: invitation.role,
      company_name: invitation.companyName,
    });
  });

  router.post('/invitations/:token/accept', async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    const body = acceptBody.parse(req.body);
    sendSession(res, await auth.acceptInvitation(token, body.name, body.password, req.ip ?? null));
  });

  return router;
}

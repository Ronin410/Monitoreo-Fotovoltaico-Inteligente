import { CredentialCipher, type EmailProvider, type InverterAdapter } from '@pv/adapters';
import type { Env } from '@pv/config';
import type { InverterBrand } from '@pv/core';
import type { PrismaClient } from '@pv/db';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { adminRouter } from './routes/admin/routes.js';
import { requireAuth } from './auth/middleware.js';
import { authRouter } from './routes/auth/routes.js';
import { clientsRouter } from './routes/clients/routes.js';
import { AuthService } from './auth/service.js';
import { companyUsersRouter } from './routes/company/routes.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { meRouter } from './routes/me/routes.js';
import { plantsRouter } from './routes/plants/routes.js';

export type AppDeps = {
  env: Env;
  /** Conexión como pv_app (datos de empresa, siempre con withTenant). */
  db: PrismaClient;
  /** Conexión como pv_service (autenticación y plataforma). */
  serviceDb: PrismaClient;
  email: EmailProvider;
  logger: Logger;
  now?: () => Date;
  /** Adaptadores de inversor; por defecto el registro real. Las pruebas los sustituyen. */
  inverterAdapters?: Record<InverterBrand, InverterAdapter>;
};

export function createApp(deps: AppDeps): Express {
  const now = deps.now ?? (() => new Date());
  const app = express();
  app.disable('x-powered-by');
  // Render entrega la petición a través de un proxy; req.ip es la IP real del cliente.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: deps.env.APP_URL, credentials: true }));
  app.use(pinoHttp({ logger: deps.logger }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());

  const auth = new AuthService({
    env: deps.env,
    serviceDb: deps.serviceDb,
    email: deps.email,
    now,
  });
  api.use('/auth', authRouter(auth, now));
  const authenticated = requireAuth(deps.env.JWT_SECRET, now);
  api.use('/me', authenticated, meRouter(deps.db, deps.serviceDb));
  api.use('/company', authenticated, companyUsersRouter(deps.db, auth));
  api.use('/admin', authenticated, adminRouter(deps.serviceDb, auth, now));
  api.use('/clients', authenticated, clientsRouter(deps.db));
  api.use(
    '/plants',
    authenticated,
    plantsRouter(deps.db, {
      simulatorEnabled: deps.env.SIMULATOR_ENABLED,
      cipher: CredentialCipher.fromEnv(deps.env),
      adapters: deps.inverterAdapters,
      now,
    }),
  );

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}

import { withTenant, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { authOf } from '../../auth/middleware.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { meResponse } from './schemas.js';

const sessionGone = () => new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');

/** GET /me: usuario, rol y empresa (con su marca). */
export function meRouter(
  db: PrismaClient,
  serviceDb: PrismaClient,
  features: { simulator: boolean },
): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const auth = authOf(req);

    if (auth.companyId === null) {
      // superadmin: no pertenece a ninguna empresa.
      const user = await serviceDb.user.findUnique({ where: { id: auth.userId } });
      if (!user || user.status !== 'active' || user.role !== 'superadmin') throw sessionGone();
      respond(res, meResponse, {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        company: null,
        features,
      });
      return;
    }

    const result = await withTenant(db, auth.companyId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: auth.userId } });
      const company = await tx.company.findUnique({ where: { id: auth.companyId ?? '' } });
      return { user, company };
    });
    const { user, company } = result;
    if (!user || user.status !== 'active' || !company || company.status !== 'active') {
      throw sessionGone();
    }
    respond(res, meResponse, {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        logo_url: company.logoUrl,
        brand_color: company.brandColor,
        timezone: company.timezone,
      },
      features,
    });
  });

  return router;
}

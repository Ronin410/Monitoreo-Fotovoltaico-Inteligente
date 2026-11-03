import { LEGAL_VERSION } from '@pv/core';
import { withTenant, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { recordAudit } from '../../audit.js';
import { authOf } from '../../auth/middleware.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { acceptTermsBody, meResponse } from './schemas.js';

const sessionGone = () => new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');

/** GET /me: usuario, rol y empresa (con su marca). */
export function meRouter(
  db: PrismaClient,
  serviceDb: PrismaClient,
  features: { simulator: boolean },
  now: () => Date,
): Router {
  const router = Router();
  const legalOf = (u: { termsVersion: string | null }) => ({
    version: LEGAL_VERSION,
    accepted: u.termsVersion === LEGAL_VERSION,
  });

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
        legal: legalOf(user),
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
      legal: legalOf(user),
    });
  });

  /**
   * Acepta los términos de uso y el aviso de privacidad vigentes (docs/plan-lanzamiento.md 3.5).
   * Guarda versión y fecha en el usuario y deja el registro con la IP en la auditoría.
   */
  router.post('/accept-terms', async (req, res) => {
    const auth = authOf(req);
    const { version } = acceptTermsBody.parse(req.body);
    if (version !== LEGAL_VERSION) {
      throw new HttpError(
        409,
        'TERMS_OUTDATED',
        'Los términos cambiaron; recarga la página para ver la versión vigente',
      );
    }
    const at = now();
    await serviceDb.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: auth.userId },
        data: { termsVersion: version, termsAcceptedAt: at },
      });
      await recordAudit(tx, {
        action: 'legal.accepted',
        companyId: auth.companyId,
        userId: auth.userId,
        entityType: 'user',
        entityId: auth.userId,
        metadata: { version },
        ip: req.ip ?? null,
      });
    });
    res.status(204).end();
  });

  return router;
}

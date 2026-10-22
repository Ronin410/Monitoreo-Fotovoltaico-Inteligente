import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@pv/adapters';
import { applySettingsPatch, parseCompanySettings, type CompanySettings } from '@pv/core';
import { withTenant, type Company, type Prisma, type PrismaClient } from '@pv/db';
import express, { Router } from 'express';
import type { z } from 'zod';
import { recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';
import { detectImage, MAX_LOGO_BYTES, sanitizeSvg } from '../../files/images.js';
import { companyResponse, logoParams, logoResponse, patchCompanyBody } from './schemas.js';

// Configuración de la empresa (F2-T4, specs/10 §Empresa y usuarios). GET para todos los roles
// de la empresa; PATCH y logo solo company_admin.

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

function companyDto(c: Company): z.input<typeof companyResponse> {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    logo_url: c.logoUrl,
    brand_color: c.brandColor,
    timezone: c.timezone,
    plan: c.plan,
    ai_monthly_token_budget: c.aiMonthlyTokenBudget,
    settings: parseCompanySettings(c.settings),
  };
}

/** { "thresholds.offline_hours": { from: 4, to: 6 } } con solo lo que cambió. */
function settingsChanges(before: CompanySettings, after: CompanySettings) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const section of ['thresholds', 'defaults', 'notifications'] as const) {
    const a: Record<string, unknown> = before[section];
    const b: Record<string, unknown> = after[section];
    for (const key of Object.keys(b)) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        changes[`${section}.${key}`] = { from: a[key], to: b[key] };
      }
    }
  }
  return changes;
}

const logoKey = (companyId: string, file: string) => `logos/${companyId}/${file}`;

export function companyProfileRouter(
  db: PrismaClient,
  storage: StorageProvider,
  apiUrl: string,
): Router {
  const router = Router();
  const canConfigure = requirePermission('company:configure');
  const logoUrlPrefix = `${apiUrl.replace(/\/$/, '')}/api/public/logos/`;

  router.get('/', requirePermission('company:read'), async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const company = await withTenant(db, companyId, (tx) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId } }),
    );
    respond(res, companyResponse, companyDto(company));
  });

  router.patch('/', canConfigure, async (req, res) => {
    const session = companyAuthOf(req);
    const body = patchCompanyBody.parse(req.body);

    const updated = await withTenant(db, session.companyId, async (tx) => {
      const current = await tx.company.findUniqueOrThrow({ where: { id: session.companyId } });
      const before = parseCompanySettings(current.settings);
      // Valida el resultado completo; un valor fuera de rango responde 400 (ZodError).
      const next = body.settings ? applySettingsPatch(current.settings, body.settings) : null;

      const company = await tx.company.update({
        where: { id: session.companyId },
        data: {
          name: body.name,
          brandColor: body.brand_color,
          timezone: body.timezone,
          ...(next ? { settings: next.stored as Prisma.InputJsonObject } : {}),
        },
      });

      const changes: Record<string, { from: unknown; to: unknown }> = {
        ...(next ? settingsChanges(before, next.settings) : {}),
      };
      for (const [field, key] of [
        ['name', 'name'],
        ['brandColor', 'brand_color'],
        ['timezone', 'timezone'],
      ] as const) {
        if (current[field] !== company[field]) {
          changes[key] = { from: current[field], to: company[field] };
        }
      }
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          action: 'company.settings_updated',
          companyId: session.companyId,
          userId: session.userId,
          entityType: 'company',
          entityId: session.companyId,
          metadata: { changes: JSON.parse(JSON.stringify(changes)) },
          ip: req.ip ?? null,
        });
      }
      return company;
    });
    respond(res, companyResponse, companyDto(updated));
  });

  /**
   * Sube el logo como cuerpo binario (Content-Type image/png, image/jpeg o image/svg+xml).
   * El tipo se verifica por el contenido y el SVG se sanea antes de guardarlo.
   */
  router.post(
    '/logo',
    canConfigure,
    express.raw({ type: () => true, limit: MAX_LOGO_BYTES }),
    async (req, res) => {
      const session = companyAuthOf(req);
      const declared = (req.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!LOGO_TYPES.includes(declared)) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El logo debe ser PNG, JPG o SVG');
      }
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const kind = detectImage(raw);
      if (!kind || kind.contentType !== declared) {
        throw new HttpError(
          400,
          'INVALID_IMAGE',
          'El archivo no es una imagen PNG, JPG o SVG válida',
        );
      }
      let body = raw;
      if (kind.contentType === 'image/svg+xml') {
        const clean = sanitizeSvg(raw.toString('utf8'));
        if (!clean) throw new HttpError(400, 'INVALID_IMAGE', 'El SVG no es válido');
        body = Buffer.from(clean, 'utf8');
      }

      const file = `${randomUUID()}.${kind.ext}`;
      await storage.put(logoKey(session.companyId, file), body, kind.contentType);
      const logoUrl = `${logoUrlPrefix}${session.companyId}/${file}`;

      const previous = await withTenant(db, session.companyId, async (tx) => {
        const current = await tx.company.findUniqueOrThrow({ where: { id: session.companyId } });
        await tx.company.update({ where: { id: session.companyId }, data: { logoUrl } });
        await recordAudit(tx, {
          action: 'company.settings_updated',
          companyId: session.companyId,
          userId: session.userId,
          entityType: 'company',
          entityId: session.companyId,
          metadata: { changes: { logo_url: { from: current.logoUrl, to: logoUrl } } },
          ip: req.ip ?? null,
        });
        return current.logoUrl;
      });

      // Borra el logo anterior si era nuestro.
      if (previous?.startsWith(`${logoUrlPrefix}${session.companyId}/`)) {
        const oldFile = previous.slice(`${logoUrlPrefix}${session.companyId}/`.length);
        if (logoParams.safeParse({ companyId: session.companyId, file: oldFile }).success) {
          await storage.delete(logoKey(session.companyId, oldFile));
        }
      }
      respond(res, logoResponse, { logo_url: logoUrl }, 201);
    },
  );

  return router;
}

/**
 * GET /api/public/logos/:companyId/:file, sin autenticación: el logo aparece en correos, PDFs y
 * en el encabezado del web. El nombre del archivo es aleatorio y se sirve con una CSP que impide
 * ejecutar nada aunque sea SVG.
 */
export function publicLogosRouter(storage: StorageProvider): Router {
  const router = Router();
  router.get('/:companyId/:file', async (req, res) => {
    const params = logoParams.safeParse(req.params);
    if (!params.success) throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
    const object = await storage.get(logoKey(params.data.companyId, params.data.file));
    if (!object) throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
    res.set({
      'Content-Type': object.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(object.body);
  });
  return router;
}

import {
  COMPANY_INTEGRATIONS,
  COMPANY_INTEGRATION_PROVIDERS,
  type CompanyIntegrationDefinition,
  type CompanyIntegrationProvider,
  type CredentialCipher,
} from '@pv/adapters';
import { withTenant, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { FixedWindowRateLimiter } from '../../auth/rate-limit.js';
import { HttpError } from '../../http/errors.js';
import { respond } from '../../http/respond.js';

// Integraciones de la empresa (docs/fabricantes/goodwe-openapi.md): la instaladora captura las
// llaves que le entrega el fabricante (GoodWe: Client ID, Client Secret y servidor). Solo
// company_admin. Se guardan cifradas y nunca se devuelven: la API solo dice si existen y el
// resultado de la última prueba (specs/02).

const TEST_TIMEOUT_MS = 20_000;
const TEST_OK = 'Conexión exitosa';
const TEST_FAILED =
  'No se pudo conectar. Revise las llaves y el servidor; si son correctos, puede que el acceso todavía no esté aprobado por el fabricante.';

const providerParam = z.object({
  provider: z.enum(COMPANY_INTEGRATION_PROVIDERS as [string, ...string[]]),
});
const putBody = z.object({ credentials: z.record(z.string(), z.unknown()) });

export const integrationStatus = z.object({
  provider: z.string(),
  configured: z.boolean(),
  updated_at: z.date().nullable(),
  last_test_at: z.date().nullable(),
  last_test_ok: z.boolean().nullable(),
});
export const integrationsResponse = z.object({ data: z.array(integrationStatus) });
export const integrationTestResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  tested_at: z.date(),
});

type Row = { updatedAt: Date; lastTestAt: Date | null; lastTestOk: boolean | null } | null;
const statusDto = (provider: string, row: Row) => ({
  provider,
  configured: row !== null,
  updated_at: row?.updatedAt ?? null,
  last_test_at: row?.lastTestAt ?? null,
  last_test_ok: row?.lastTestOk ?? null,
});

const notFound = () =>
  new HttpError(404, 'NOT_FOUND', 'La integración no existe o no está configurada');

export function companyIntegrationsRouter(
  db: PrismaClient,
  cipher: CredentialCipher,
  now: () => Date,
  integrations: Record<string, CompanyIntegrationDefinition> = COMPANY_INTEGRATIONS,
): Router {
  const router = Router();
  const canConfigure = requirePermission('company:configure');
  const limiter = new FixedWindowRateLimiter(5, 60_000, () => now().getTime());

  const parseProvider = (params: unknown) => {
    const parsed = providerParam.safeParse(params);
    if (!parsed.success) throw notFound();
    return parsed.data.provider as CompanyIntegrationProvider;
  };

  router.get('/integrations', canConfigure, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const rows = await withTenant(db, companyId, (tx) =>
      tx.companyIntegration.findMany({
        select: { provider: true, updatedAt: true, lastTestAt: true, lastTestOk: true },
      }),
    );
    respond(res, integrationsResponse, {
      data: COMPANY_INTEGRATION_PROVIDERS.map((p) =>
        statusDto(p, rows.find((r) => r.provider === p) ?? null),
      ),
    });
  });

  /** Captura o reemplaza las llaves. Solo de escritura: responde su estado, nunca el valor. */
  router.put('/integrations/:provider', canConfigure, async (req, res) => {
    const session = companyAuthOf(req);
    const provider = parseProvider(req.params);
    const definition = integrations[provider];
    if (!definition) throw notFound();
    const credentials = definition.schema.parse(putBody.parse(req.body).credentials);
    const encrypted = cipher.encrypt(credentials, {
      companyId: session.companyId,
      integration: provider,
    });
    const fields = { ...encrypted, lastTestAt: null, lastTestOk: null };
    const row = await withTenant(db, session.companyId, async (tx) => {
      const previous = await tx.companyIntegration.findFirst({ where: { provider } });
      const saved = await tx.companyIntegration.upsert({
        where: { companyId_provider: { companyId: session.companyId, provider } },
        create: { ...fields, companyId: session.companyId, provider },
        update: fields,
      });
      await recordAudit(tx, {
        action: 'company.integration_updated',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'company',
        entityId: session.companyId,
        metadata: { provider, replaced: previous !== null },
        ip: req.ip ?? null,
      });
      return saved;
    });
    respond(res, integrationStatus, statusDto(provider, row));
  });

  router.delete('/integrations/:provider', canConfigure, async (req, res) => {
    const session = companyAuthOf(req);
    const provider = parseProvider(req.params);
    await withTenant(db, session.companyId, async (tx) => {
      const { count } = await tx.companyIntegration.deleteMany({ where: { provider } });
      if (count === 0) throw notFound();
      await recordAudit(tx, {
        action: 'company.integration_deleted',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'company',
        entityId: session.companyId,
        metadata: { provider },
        ip: req.ip ?? null,
      });
    });
    res.status(204).end();
  });

  /** "Probar conexión": responde solo éxito o un mensaje genérico (specs/02). */
  router.post('/integrations/:provider/test', canConfigure, async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const provider = parseProvider(req.params);
    const retryAfter = limiter.hit(`integration:${companyId}:${provider}`);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'RATE_LIMITED', 'Demasiadas pruebas seguidas. Espera un momento.');
    }
    const row = await withTenant(db, companyId, (tx) =>
      tx.companyIntegration.findFirst({ where: { provider } }),
    );
    if (!row) throw notFound();

    let ok = false;
    try {
      const creds = cipher.decrypt(row, { companyId, integration: provider });
      await Promise.race([
        integrations[provider]?.test(creds),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), TEST_TIMEOUT_MS).unref(),
        ),
      ]);
      ok = true;
    } catch (err) {
      // Solo el tipo y el código: el mensaje del proveedor podría repetir datos de la cuenta.
      req.log.warn(
        {
          provider,
          error_type: (err as Error).name,
          code: (err as { code?: unknown }).code ?? null,
        },
        'falló la prueba de la integración',
      );
    }
    const testedAt = now();
    await withTenant(db, companyId, (tx) =>
      tx.companyIntegration.update({
        where: { id: row.id },
        data: { lastTestAt: testedAt, lastTestOk: ok },
      }),
    );
    respond(res, integrationTestResponse, {
      ok,
      message: ok ? TEST_OK : TEST_FAILED,
      tested_at: testedAt,
    });
  });

  return router;
}

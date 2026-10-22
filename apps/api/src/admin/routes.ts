import { Prisma, type Company, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth/authorize.js';
import { authOf } from '../auth/middleware.js';
import { normalizeEmail, type AuthService } from '../auth/service.js';
import { HttpError } from '../http/errors.js';
import { pageArgs, paginated, paginationQuery } from '../http/pagination.js';

// Panel de superadmin (specs/10 §Superadmin, specs/02). Usa la conexión de plataforma
// (pv_service), que no puede leer datos operativos: solo empresas, conteo de plantas y uso de IA.

const slugSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'Zona horaria IANA inválida' },
);

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  timezone: timezoneSchema.optional(),
  brand_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color hexadecimal, por ejemplo #F59E0B')
    .optional(),
  plan: z.string().trim().min(1).max(40).optional(),
  ai_monthly_token_budget: z.number().int().min(0).optional(),
  admin_email: z.email().max(254),
});

const patchBody = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    plan: z.string().trim().min(1).max(40).optional(),
    ai_monthly_token_budget: z.number().int().min(0).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    error: 'Indica al menos un campo',
  });

const listQuery = paginationQuery.extend({ status: z.enum(['active', 'suspended']).optional() });
const idParam = z.object({ id: z.uuid() });

/** "Solar Culiacán, S.A." → "solar-culiacan-s-a" */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Periodo YYYY-MM de la fecha en la zona horaria de la empresa. */
function periodIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}`;
}

type CompanyStats = { plantCount: number; aiTokensThisMonth: number };

function companyDto(c: Company, stats: CompanyStats) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    plan: c.plan,
    timezone: c.timezone,
    brand_color: c.brandColor,
    ai_monthly_token_budget: c.aiMonthlyTokenBudget,
    created_at: c.createdAt,
    plant_count: stats.plantCount,
    ai_tokens_this_month: stats.aiTokensThisMonth,
  };
}

async function statsFor(
  serviceDb: PrismaClient,
  companies: Company[],
  now: Date,
): Promise<(companyId: string) => CompanyStats> {
  const ids = companies.map((c) => c.id);
  const periods = new Map(companies.map((c) => [c.id, periodIn(now, c.timezone)]));
  const [plants, usage] = await Promise.all([
    serviceDb.solarPlant.groupBy({
      by: ['companyId'],
      where: { companyId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    serviceDb.aiUsageMonthly.groupBy({
      by: ['companyId', 'period'],
      where: { companyId: { in: ids }, period: { in: [...new Set(periods.values())] } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const plantCounts = new Map(plants.map((p) => [p.companyId, p._count._all]));
  const tokens = new Map(
    usage
      .filter((u) => periods.get(u.companyId) === u.period)
      .map((u) => [
        u.companyId,
        Number(u._sum.inputTokens ?? 0n) + Number(u._sum.outputTokens ?? 0n),
      ]),
  );
  return (id: string) => ({
    plantCount: plantCounts.get(id) ?? 0,
    aiTokensThisMonth: tokens.get(id) ?? 0,
  });
}

const companyNotFound = () => new HttpError(404, 'NOT_FOUND', 'Empresa no encontrada');

export function adminRouter(serviceDb: PrismaClient, auth: AuthService, now: () => Date): Router {
  const router = Router();
  // Todo /admin es exclusivo del superadmin.
  router.use(requirePermission('companies:manage'));

  router.get('/companies', async (req, res) => {
    const query = listQuery.parse(req.query);
    const where = query.status ? { status: query.status } : {};
    const [companies, total] = await Promise.all([
      serviceDb.company.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      serviceDb.company.count({ where }),
    ]);
    const stats = await statsFor(serviceDb, companies, now());
    res.json(
      paginated(
        companies.map((c) => companyDto(c, stats(c.id))),
        query,
        total,
      ),
    );
  });

  /** Crea la empresa y la invitación de su primer company_admin en una sola transacción. */
  router.post('/companies', async (req, res) => {
    const superadmin = authOf(req);
    const body = createBody.parse(req.body);
    const slug = body.slug ?? slugify(body.name);
    if (!slug) throw new HttpError(400, 'VALIDATION_ERROR', 'No se pudo generar el slug; indícalo');
    const adminEmail = normalizeEmail(body.admin_email);

    if (await serviceDb.user.findUnique({ where: { email: adminEmail } })) {
      throw new HttpError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con ese correo');
    }

    const created = await serviceDb
      .$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: body.name,
            slug,
            timezone: body.timezone,
            brandColor: body.brand_color,
            plan: body.plan,
            aiMonthlyTokenBudget: body.ai_monthly_token_budget,
          },
        });
        const pending = auth.newInvitation({
          companyId: company.id,
          email: adminEmail,
          role: 'company_admin',
          invitedById: superadmin.userId,
        });
        const invitation = await tx.invitation.create({ data: pending.data });
        return { company, invitation, send: pending.send };
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new HttpError(409, 'SLUG_TAKEN', 'Ya existe una empresa con ese slug');
        }
        throw err;
      });
    // El correo sale solo después de confirmar la transacción.
    await created.send(created.company.name);

    res.status(201).json({
      company: companyDto(created.company, { plantCount: 0, aiTokensThisMonth: 0 }),
      invitation: {
        id: created.invitation.id,
        email: adminEmail,
        role: 'company_admin',
        expires_at: created.invitation.expiresAt,
      },
    });
  });

  router.patch('/companies/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = patchBody.parse(req.body);
    const existing = await serviceDb.company.findUnique({ where: { id } });
    if (!existing) throw companyNotFound();

    const company = await serviceDb.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: {
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.plan === undefined ? {} : { plan: body.plan }),
          ...(body.ai_monthly_token_budget === undefined
            ? {}
            : { aiMonthlyTokenBudget: body.ai_monthly_token_budget }),
        },
      });
      // Suspender cierra todas las sesiones de la empresa (specs/03: no puede iniciar sesión).
      if (body.status === 'suspended' && existing.status !== 'suspended') {
        await tx.refreshToken.updateMany({
          where: { revokedAt: null, user: { companyId: id } },
          data: { revokedAt: now() },
        });
      }
      return updated;
    });
    const stats = await statsFor(serviceDb, [company], now());
    res.json(companyDto(company, stats(company.id)));
  });

  return router;
}

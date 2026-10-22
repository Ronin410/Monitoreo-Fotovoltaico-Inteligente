import { withTenant, type Client, type PrismaClient } from '@pv/db';
import { Router } from 'express';
import type { z } from 'zod';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { dec } from '../../http/decimal.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  clientResponse,
  clientsQuery,
  clientsResponse,
  createClientBody,
  patchClientBody,
} from './schemas.js';

// CRUD de clientes con borrado lógico (F2-T1). Roles: company_admin y operator.

const clientNotFound = () => new HttpError(404, 'NOT_FOUND', 'Cliente no encontrado');

/** Plantas vigentes (sin borrar) de cada cliente. */
const withPlantCount = {
  _count: { select: { plants: { where: { deletedAt: null } } } },
} as const;

type ClientWithCount = Client & { _count: { plants: number } };

function clientDto(c: ClientWithCount): z.input<typeof clientResponse> {
  return {
    id: c.id,
    name: c.name,
    contact_name: c.contactName,
    phone: c.phone,
    email: c.email,
    address: c.address,
    colonia: c.colonia,
    postal_code: c.postalCode,
    city: c.city,
    state: c.state,
    lat: dec(c.lat),
    lon: dec(c.lon),
    cfe_tariff: c.cfeTariff,
    avg_monthly_kwh: dec(c.avgMonthlyKwh),
    avg_monthly_bill_mxn: dec(c.avgMonthlyBillMxn),
    tariff_mxn_per_kwh: dec(c.tariffMxnPerKwh),
    report_email: c.reportEmail,
    plant_count: c._count.plants,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

/**
 * Body (snake_case) → campos de Prisma. Los ausentes quedan `undefined` y Prisma no los toca,
 * así sirve para crear y para el PATCH parcial.
 */
function toData(b: Partial<z.output<typeof createClientBody>>) {
  return {
    name: b.name,
    contactName: b.contact_name,
    phone: b.phone,
    email: b.email,
    address: b.address,
    colonia: b.colonia,
    postalCode: b.postal_code,
    city: b.city,
    state: b.state,
    lat: b.lat,
    lon: b.lon,
    cfeTariff: b.cfe_tariff,
    avgMonthlyKwh: b.avg_monthly_kwh,
    avgMonthlyBillMxn: b.avg_monthly_bill_mxn,
    tariffMxnPerKwh: b.tariff_mxn_per_kwh,
    reportEmail: b.report_email,
  };
}

export function clientsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(requirePermission('inventory:manage'));

  router.get('/', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const query = clientsQuery.parse(req.query);
    const where = {
      deletedAt: null,
      ...(query.postal_code ? { postalCode: query.postal_code } : {}),
      ...(query.colonia
        ? { colonia: { equals: query.colonia, mode: 'insensitive' as const } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { contactName: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [clients, total] = await withTenant(db, companyId, (tx) =>
      Promise.all([
        tx.client.findMany({
          where,
          include: withPlantCount,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...pageArgs(query),
        }),
        tx.client.count({ where }),
      ]),
    );
    respond(res, clientsResponse, paginated(clients.map(clientDto), query, total));
  });

  router.post('/', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const body = createClientBody.parse(req.body);
    const client = await withTenant(db, companyId, (tx) =>
      tx.client.create({
        data: {
          ...toData(body),
          // Obligatorios al crear (el body ya los validó).
          name: body.name,
          address: body.address,
          colonia: body.colonia,
          postalCode: body.postal_code,
          lat: body.lat,
          lon: body.lon,
          companyId,
        },
        include: withPlantCount,
      }),
    );
    respond(res, clientResponse, clientDto(client), 201);
  });

  router.get('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const client = await withTenant(db, companyId, (tx) =>
      tx.client.findFirst({ where: { id, deletedAt: null }, include: withPlantCount }),
    );
    if (!client) throw clientNotFound();
    respond(res, clientResponse, clientDto(client));
  });

  router.patch('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const body = patchClientBody.parse(req.body);
    const client = await withTenant(db, companyId, async (tx) => {
      const { count } = await tx.client.updateMany({
        where: { id, deletedAt: null },
        data: toData(body),
      });
      if (count === 0) throw clientNotFound();
      return tx.client.findUniqueOrThrow({ where: { id }, include: withPlantCount });
    });
    respond(res, clientResponse, clientDto(client));
  });

  /** Borrado lógico. No se permite si el cliente aún tiene plantas vigentes. */
  router.delete('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    await withTenant(db, companyId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id, deletedAt: null },
        include: withPlantCount,
      });
      if (!client) throw clientNotFound();
      if (client._count.plants > 0) {
        throw new HttpError(
          409,
          'CLIENT_HAS_PLANTS',
          'Primero elimina o reasigna las plantas de este cliente',
        );
      }
      await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
    });
    res.status(204).end();
  });

  return router;
}

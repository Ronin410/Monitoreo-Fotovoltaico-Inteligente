import { parseCompanySettings } from '@pv/core';
import { Prisma, withTenant, type PrismaClient, type SolarPlant, type TenantDb } from '@pv/db';
import { Router } from 'express';
import type { z } from 'zod';
import { recordAudit } from '../../audit.js';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { dec } from '../../http/decimal.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  createPlantBody,
  patchPlantBody,
  plantResponse,
  plantsQuery,
  plantsResponse,
} from './schemas.js';

// CRUD de plantas (F2-T2). Roles: company_admin y operator. Los valores técnicos sin indicar
// toman los de la empresa (settings.defaults) y la ubicación se copia del cliente.

export type PlantsRouterOptions = {
  /** SIMULATOR_ENABLED: solo staging o demo pueden usar el inversor `simulator`. */
  simulatorEnabled: boolean;
};

const plantNotFound = () => new HttpError(404, 'NOT_FOUND', 'Planta no encontrada');
const invalidClient = () =>
  new HttpError(400, 'INVALID_CLIENT', 'El cliente no existe o fue eliminado');
const badRequest = (code: string, message: string) => new HttpError(400, code, message);

const withClient = { client: { select: { id: true, name: true } } } as const;
type PlantWithClient = SolarPlant & { client: { id: string; name: string } };

const SORTS: Record<
  z.output<typeof plantsQuery>['sort'],
  Prisma.SolarPlantOrderByWithRelationInput
> = {
  name: { name: 'asc' },
  '-name': { name: 'desc' },
  created_at: { createdAt: 'asc' },
  '-created_at': { createdAt: 'desc' },
  capacity_kwp: { capacityKwp: 'asc' },
  '-capacity_kwp': { capacityKwp: 'desc' },
};

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** null se guarda como NULL de SQL, no como JSON `null`. */
const jsonOrDbNull = (value: object | null | undefined) =>
  value === undefined
    ? undefined
    : value === null
      ? Prisma.DbNull
      : (value as Prisma.InputJsonObject);

function plantDto(p: PlantWithClient): z.input<typeof plantResponse> {
  return {
    id: p.id,
    client: p.client,
    name: p.name,
    capacity_kwp: dec(p.capacityKwp),
    tilt_deg: dec(p.tiltDeg),
    azimuth_deg: dec(p.azimuthDeg),
    noct_c: dec(p.noctC),
    gamma_pct_per_c: dec(p.gammaPctPerC),
    panel_model: p.panelModel,
    panel_count: p.panelCount,
    inverter_brand: p.inverterBrand,
    inverter_model: p.inverterModel,
    inverter_serial: p.inverterSerial,
    commissioning_date: fromDate(p.commissioningDate),
    lat: dec(p.lat),
    lon: dec(p.lon),
    postal_code: p.postalCode,
    colonia: p.colonia,
    status: p.status,
    last_reading_at: p.lastReadingAt,
    last_power_kw: dec(p.lastPowerKw),
    simulation_profile: p.simulationProfile as z.input<typeof plantResponse>['simulation_profile'],
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/** Campos comunes de crear y editar; los ausentes quedan `undefined` y Prisma no los toca. */
function toData(b: Partial<z.output<typeof patchPlantBody>>) {
  return {
    clientId: b.client_id,
    name: b.name,
    capacityKwp: b.capacity_kwp,
    tiltDeg: b.tilt_deg,
    azimuthDeg: b.azimuth_deg,
    noctC: b.noct_c,
    gammaPctPerC: b.gamma_pct_per_c,
    panelModel: b.panel_model,
    panelCount: b.panel_count,
    inverterBrand: b.inverter_brand,
    inverterModel: b.inverter_model,
    inverterSerial: b.inverter_serial,
    commissioningDate:
      b.commissioning_date === undefined
        ? undefined
        : b.commissioning_date === null
          ? null
          : toDate(b.commissioning_date),
    lat: b.lat,
    lon: b.lon,
    postalCode: b.postal_code,
    colonia: b.colonia,
    status: b.status,
    simulationProfile: jsonOrDbNull(b.simulation_profile),
  };
}

async function activeClient(tx: TenantDb, clientId: string) {
  const client = await tx.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client) throw invalidClient();
  return client;
}

/** Reglas del inversor simulado (specs/04 §3, specs/09 §Formulario de planta). */
function checkSimulator(
  brand: string,
  profile: object | null | undefined,
  brandChanged: boolean,
  simulatorEnabled: boolean,
): void {
  if (brand === 'simulator' && brandChanged && !simulatorEnabled) {
    throw badRequest(
      'SIMULATOR_DISABLED',
      'El inversor simulado solo está disponible en staging y demo',
    );
  }
  if (brand !== 'simulator' && profile) {
    throw badRequest(
      'INVALID_SIMULATION_PROFILE',
      'simulation_profile solo aplica al inversor simulado',
    );
  }
}

export function plantsRouter(db: PrismaClient, options: PlantsRouterOptions): Router {
  const router = Router();
  router.use(requirePermission('inventory:manage'));

  router.get('/', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const query = plantsQuery.parse(req.query);
    const where: Prisma.SolarPlantWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.postal_code ? { postalCode: query.postal_code } : {}),
      ...(query.colonia ? { colonia: { equals: query.colonia, mode: 'insensitive' } } : {}),
      ...(query.brand ? { inverterBrand: query.brand } : {}),
      ...(query.client_id ? { clientId: query.client_id } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { client: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [plants, total] = await withTenant(db, companyId, (tx) =>
      Promise.all([
        tx.solarPlant.findMany({
          where,
          include: withClient,
          orderBy: [SORTS[query.sort], { id: 'asc' }],
          ...pageArgs(query),
        }),
        tx.solarPlant.count({ where }),
      ]),
    );
    respond(res, plantsResponse, paginated(plants.map(plantDto), query, total));
  });

  router.post('/', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const body = createPlantBody.parse(req.body);
    checkSimulator(body.inverter_brand, body.simulation_profile, true, options.simulatorEnabled);

    const plant = await withTenant(db, companyId, async (tx) => {
      const client = await activeClient(tx, body.client_id);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const defaults = parseCompanySettings(company.settings).defaults;
      return tx.solarPlant.create({
        data: {
          ...toData(body),
          companyId,
          clientId: client.id,
          name: body.name,
          capacityKwp: body.capacity_kwp,
          inverterBrand: body.inverter_brand,
          tiltDeg: body.tilt_deg ?? defaults.tilt_deg,
          azimuthDeg: body.azimuth_deg ?? defaults.azimuth_deg,
          noctC: body.noct_c ?? defaults.noct_c,
          gammaPctPerC: body.gamma_pct_per_c ?? defaults.gamma_pct_per_c,
          // Ubicación: se copia del cliente si no se indica (para agrupar por zona).
          lat: body.lat ?? client.lat,
          lon: body.lon ?? client.lon,
          postalCode: body.postal_code ?? client.postalCode,
          colonia: body.colonia ?? client.colonia,
        },
        include: withClient,
      });
    });
    respond(res, plantResponse, plantDto(plant), 201);
  });

  router.get('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const plant = await withTenant(db, companyId, (tx) =>
      tx.solarPlant.findFirst({ where: { id, deletedAt: null }, include: withClient }),
    );
    if (!plant) throw plantNotFound();
    respond(res, plantResponse, plantDto(plant));
  });

  router.patch('/:id', async (req, res) => {
    const { companyId } = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const body = patchPlantBody.parse(req.body);

    const plant = await withTenant(db, companyId, async (tx) => {
      const current = await tx.solarPlant.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw plantNotFound();
      if (body.client_id && body.client_id !== current.clientId) {
        await activeClient(tx, body.client_id);
      }

      const brand = body.inverter_brand ?? current.inverterBrand;
      const brandChanged = brand !== current.inverterBrand;
      checkSimulator(brand, body.simulation_profile, brandChanged, options.simulatorEnabled);

      const lat = body.lat === undefined ? dec(current.lat) : body.lat;
      const lon = body.lon === undefined ? dec(current.lon) : body.lon;
      if ((lat === null) !== (lon === null)) {
        throw badRequest('VALIDATION_ERROR', 'Indica lat y lon juntas');
      }

      const data = toData(body);
      // Al dejar de ser simulada, el perfil de simulación se descarta.
      if (brand !== 'simulator' && current.simulationProfile !== null) {
        data.simulationProfile = Prisma.DbNull;
      }
      return tx.solarPlant.update({ where: { id }, data, include: withClient });
    });
    respond(res, plantResponse, plantDto(plant));
  });

  /** Borrado lógico, auditado (specs/02). */
  router.delete('/:id', async (req, res) => {
    const session = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    await withTenant(db, session.companyId, async (tx) => {
      const plant = await tx.solarPlant.findFirst({ where: { id, deletedAt: null } });
      if (!plant) throw plantNotFound();
      await tx.solarPlant.update({ where: { id }, data: { deletedAt: new Date() } });
      await recordAudit(tx, {
        action: 'plant.deleted',
        companyId: session.companyId,
        userId: session.userId,
        entityType: 'plant',
        entityId: id,
        metadata: { name: plant.name, client_id: plant.clientId },
        ip: req.ip ?? null,
      });
    });
    res.status(204).end();
  });

  return router;
}

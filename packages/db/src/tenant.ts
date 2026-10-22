import { z } from 'zod';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';

// Aislamiento entre empresas, capa de aplicación (ver specs/02 §Aislamiento en dos capas).
// withTenant abre una transacción, fija app.company_id para RLS (capa 2) y entrega un cliente
// que agrega company_id a cada consulta (capa 1). Las dos capas son obligatorias.

/** Modelos con company_id. Una prueba verifica que coincida con las columnas de la base. */
export const TENANT_MODELS = [
  'Invitation',
  'Client',
  'SolarPlant',
  'InverterCredential',
  'TelemetryReading',
  'PlantWeatherHourly',
  'PlantDailyMetric',
  'PlantEvent',
  'Alert',
  'MaintenanceTicket',
  'Notification',
  'MonthlyReport',
  'AiConversation',
  'AiMessage',
  'AiUsageMonthly',
  'User',
  'AuditLog',
  'JobRun',
] as const satisfies readonly Prisma.ModelName[];

/** Modelos sin company_id que sí se pueden usar dentro de una empresa. */
const UNSCOPED_MODELS = new Set<string>(['RefreshToken']);

/** Operaciones que la aplicación no puede hacer sobre `companies` (solo el superadmin). */
const COMPANY_FORBIDDEN_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const companyIdSchema = z.uuid({ error: 'companyId debe ser un UUID' });

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantViolationError';
  }
}

type Args = Record<string, unknown>;

function scopeWhere(where: unknown, field: string, companyId: string, model: string): Args {
  const w = (where ?? {}) as Args;
  if (field in w && w[field] !== companyId) {
    throw new TenantViolationError(`${model}: ${field} no coincide con la empresa de la sesión`);
  }
  return { ...w, [field]: companyId };
}

function scopeData(data: unknown, field: string, companyId: string, model: string): Args {
  const d = (data ?? {}) as Args;
  if (field in d && d[field] !== companyId) {
    throw new TenantViolationError(`${model}: ${field} no coincide con la empresa de la sesión`);
  }
  return { ...d, [field]: companyId };
}

/** Rechaza cambiar el company_id en un update; no lo agrega si no viene. */
function checkUpdateData(data: unknown, field: string, companyId: string, model: string): void {
  const d = (data ?? {}) as Args;
  if (field in d && d[field] !== companyId) {
    throw new TenantViolationError(`${model}: no se puede cambiar ${field}`);
  }
}

function scopeArgs(model: string, operation: string, rawArgs: unknown, companyId: string): Args {
  const isCompany = model === 'Company';
  if (isCompany && COMPANY_FORBIDDEN_OPERATIONS.has(operation)) {
    throw new TenantViolationError(`Company.${operation} no está permitido dentro de una empresa`);
  }
  const field = isCompany ? 'id' : 'companyId';
  const args: Args = { ...((rawArgs ?? {}) as Args) };

  switch (operation) {
    case 'create':
      args.data = scopeData(args.data, field, companyId, model);
      return args;
    case 'createMany':
    case 'createManyAndReturn':
      args.data = Array.isArray(args.data)
        ? args.data.map((d) => scopeData(d, field, companyId, model))
        : scopeData(args.data, field, companyId, model);
      return args;
    case 'upsert':
      args.where = scopeWhere(args.where, field, companyId, model);
      args.create = scopeData(args.create, field, companyId, model);
      checkUpdateData(args.update, field, companyId, model);
      return args;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      args.where = scopeWhere(args.where, field, companyId, model);
      checkUpdateData(args.data, field, companyId, model);
      return args;
    case 'findUnique':
    case 'findUniqueOrThrow':
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'delete':
    case 'deleteMany':
      args.where = scopeWhere(args.where, field, companyId, model);
      return args;
    default:
      throw new TenantViolationError(
        `${model}.${operation} no está soportado dentro de una empresa`,
      );
  }
}

const tenantModels = new Set<string>(TENANT_MODELS);

function tenantExtension(companyId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) return query(args);
          if (model !== 'Company' && !tenantModels.has(model)) {
            throw new TenantViolationError(`${model} no está permitido dentro de una empresa`);
          }
          return query(scopeArgs(model, operation, args, companyId) as typeof args);
        },
      },
    },
  });
}

function scopedClient(db: PrismaClient, companyId: string) {
  return db.$extends(tenantExtension(companyId));
}

type ScopedTx = Parameters<Parameters<ReturnType<typeof scopedClient>['$transaction']>[0]>[0];

/**
 * Cliente de base de datos limitado a una empresa. Solo existe dentro de withTenant.
 * Sin las variantes *Unsafe de SQL crudo: con ellas se podría volver a fijar app.company_id.
 * $queryRaw (con plantilla y parámetros) sigue disponible y RLS aplica igual.
 */
export type TenantDb = Omit<ScopedTx, '$executeRawUnsafe' | '$queryRawUnsafe'>;

export type WithTenantOptions = {
  /** Tiempo máximo de la transacción en ms (por defecto 10 s). */
  timeout?: number;
};

/**
 * Ejecuta `fn` dentro de una transacción limitada a `companyId`:
 * fija app.company_id para RLS y agrega company_id a cada consulta.
 * `companyId` debe venir de la sesión o del job, nunca de la entrada del cliente ni de la IA.
 */
export async function withTenant<T>(
  db: PrismaClient,
  companyId: string,
  fn: (tx: TenantDb) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  const id = companyIdSchema.parse(companyId);
  return scopedClient(db, id).$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${id}, true)`;
      return fn(tx);
    },
    { timeout: options.timeout ?? 10_000 },
  );
}

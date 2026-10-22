export { createPrismaClient } from './client.js';
export { listActiveCompanies } from './platform.js';
export { assertAppRoleIsSafe, UnsafeDatabaseRoleError } from './roles.js';
export {
  TENANT_MODELS,
  TenantViolationError,
  withTenant,
  type TenantDb,
  type WithTenantOptions,
} from './tenant.js';
export { Prisma, PrismaClient } from './generated/prisma/client.js';
export type * from './generated/prisma/client.js';

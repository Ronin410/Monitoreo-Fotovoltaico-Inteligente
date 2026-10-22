import type { PrismaClient } from './generated/prisma/client.js';

/**
 * Empresas cuyos jobs deben correr (conexión pv_service). Una empresa suspendida no inicia
 * sesión y sus jobs se pausan (specs/03 §companies); los orquestadores del worker encolan
 * trabajo solo para las empresas que devuelve esta función.
 */
export function listActiveCompanies(
  serviceDb: PrismaClient,
): Promise<{ id: string; timezone: string }[]> {
  return serviceDb.company.findMany({
    where: { status: 'active' },
    select: { id: true, timezone: true },
    orderBy: { id: 'asc' },
  });
}

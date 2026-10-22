import type { PrismaClient } from './generated/prisma/client.js';

export class UnsafeDatabaseRoleError extends Error {
  constructor(role: string, reasons: string[]) {
    super(
      `El rol de base de datos "${role}" no es seguro para la aplicación: ${reasons.join('; ')}. ` +
        'Usa un usuario miembro de pv_app (ver packages/db/README.md).',
    );
    this.name = 'UnsafeDatabaseRoleError';
  }
}

/**
 * Verifica que la conexión de la aplicación no pueda saltarse RLS (specs/02): el rol no es
 * superusuario, no tiene BYPASSRLS, no es dueño de tablas y es miembro de pv_app.
 */
export async function assertAppRoleIsSafe(db: PrismaClient): Promise<void> {
  const [row] = await db.$queryRaw<
    { role: string; superuser: boolean; bypassrls: boolean; owned: bigint; in_app: boolean }[]
  >`
    SELECT current_user::text AS role,
           r.rolsuper AS superuser,
           r.rolbypassrls AS bypassrls,
           (SELECT count(*) FROM pg_tables
             WHERE schemaname = 'public' AND tableowner = current_user) AS owned,
           pg_has_role(current_user, 'pv_app', 'MEMBER') AS in_app
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (!row) throw new UnsafeDatabaseRoleError('desconocido', ['no se pudo leer el rol']);

  const reasons: string[] = [];
  if (row.superuser) reasons.push('es superusuario');
  if (row.bypassrls) reasons.push('tiene BYPASSRLS');
  if (row.owned > 0n) reasons.push(`es dueño de ${row.owned} tablas`);
  if (!row.in_app) reasons.push('no es miembro de pv_app');
  if (reasons.length > 0) throw new UnsafeDatabaseRoleError(row.role, reasons);
}

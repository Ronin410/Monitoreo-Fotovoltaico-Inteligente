import type { Prisma } from '@pv/db';

/** Convierte un Decimal de Prisma (numeric de PostgreSQL) a número para JSON. */
export function dec(value: Prisma.Decimal): number;
export function dec(value: Prisma.Decimal | null): number | null;
export function dec(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

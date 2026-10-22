import { z } from 'zod';

// Paginación de specs/10: ?page=1&page_size=25 (máximo 100).
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationQuery>;

export function pageArgs(p: Pagination): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.page_size, take: p.page_size };
}

export function paginated<T>(data: T[], p: Pagination, total: number) {
  return { data, page: p.page, page_size: p.page_size, total };
}

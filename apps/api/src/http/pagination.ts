import { z } from 'zod';

// Paginación de specs/10: ?page=1&page_size=25 (máximo 100);
// respuesta { data, page, page_size, total }.
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

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
  });
}

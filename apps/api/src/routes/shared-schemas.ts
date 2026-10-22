import { z } from 'zod';

export const emailSchema = z.email({ error: 'Correo inválido' }).max(254);
export const idParam = z.object({ id: z.uuid({ error: 'id inválido' }) });
export const companyRoleSchema = z.enum(['company_admin', 'operator', 'technician']);
export const userRoleSchema = z.enum(['superadmin', 'company_admin', 'operator', 'technician']);

import type { Response } from 'express';
import type { z } from 'zod';

/**
 * Responde validando con el esquema de salida (specs/10). El esquema descarta los campos que no
 * declara, así una respuesta nunca incluye datos de más (por ejemplo credenciales o hashes). Si
 * los datos no cumplen el esquema es un error de programación y responde 500.
 */
export function respond<S extends z.ZodType>(
  res: Response,
  schema: S,
  data: z.input<S>,
  status = 200,
): void {
  res.status(status).json(schema.parse(data));
}

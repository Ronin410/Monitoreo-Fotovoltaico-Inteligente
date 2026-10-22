import { z } from 'zod';

// Definición de un job (specs/01 §Jobs): nombre, payload validado con zod, alcance y reintentos.
// La comparten la api (encola) y el worker (ejecuta).

export type JobScope = 'company' | 'platform';

export type JobDefinition<P extends z.ZodType = z.ZodType> = {
  name: string;
  /** Validación del payload en ambos bordes: al encolar y al ejecutar. */
  payload: P;
  /**
   * `company`: el payload trae company_id; el job corre dentro de esa empresa y se pausa si la
   * empresa está suspendida. `platform`: jobs globales (orquestadores, mantenimiento).
   */
  scope: JobScope;
  /** Reintentos ante error (por defecto 3), con backoff exponencial desde retryDelaySeconds. */
  retryLimit?: number;
  retryDelaySeconds?: number;
  /** Tiempo máximo de una ejecución (por defecto 15 min). */
  expireInSeconds?: number;
  /**
   * Idempotencia al encolar: clave del trabajo (por ejemplo `metrics.daily:<empresa>:<fecha>`).
   * Si la tiene, la cola solo admite un job pendiente o activo por clave (política `exclusive`)
   * y encolar otro igual no hace nada. Los handlers además deben ser idempotentes (upserts).
   */
  singletonKey?: (payload: z.output<P>) => string;
  /** Ejecución periódica (cron de 5 campos) en la zona horaria indicada (UTC por defecto). */
  schedule?: { cron: string; tz?: string };
};

/** Payload base de los jobs por empresa: company_id explícito (specs/01 §Jobs). */
export const companyPayload = z.object({ company_id: z.uuid() });

export function defineJob<P extends z.ZodType>(definition: JobDefinition<P>): JobDefinition<P> {
  if (!/^[a-z]+(\.[a-z_]+)+$/.test(definition.name)) {
    throw new Error(`Nombre de job inválido: ${definition.name}`);
  }
  return definition;
}

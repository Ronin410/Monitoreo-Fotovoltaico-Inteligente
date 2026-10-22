import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';

/** Error con respuesta HTTP controlada (formato de specs/10). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = () => {
  throw new HttpError(404, 'NOT_FOUND', 'Recurso no encontrado');
};

function bodyParserError(err: unknown): HttpError | null {
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') return new HttpError(400, 'INVALID_JSON', 'JSON inválido');
  if (type === 'entity.too.large') {
    return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición es demasiado grande');
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    let httpError: HttpError;
    if (err instanceof HttpError) {
      httpError = err;
    } else if (err instanceof z.ZodError) {
      httpError = new HttpError(
        400,
        'VALIDATION_ERROR',
        'Datos inválidos',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    } else {
      httpError =
        bodyParserError(err) ?? new HttpError(500, 'INTERNAL_ERROR', 'Error interno del servidor');
      if (httpError.status === 500) logger.error({ err }, 'error no controlado');
    }
    res.status(httpError.status).json({
      error: {
        code: httpError.code,
        message: httpError.message,
        ...(httpError.details === undefined ? {} : { details: httpError.details }),
      },
    });
  };
}

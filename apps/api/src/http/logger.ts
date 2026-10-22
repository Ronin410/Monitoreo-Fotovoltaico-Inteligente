import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * Logs estructurados en JSON (specs/01 §Observabilidad). Nunca se registran credenciales ni
 * tokens: se redactan encabezados de autenticación, cookies y campos sensibles.
 */
export function createLogger(level = 'info', destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'pv-api' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.token',
          '*.access_token',
          '*.refresh_token',
          '*.passwordHash',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

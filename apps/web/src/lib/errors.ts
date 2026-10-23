import { ApiError } from './api';

/** Mensaje para mostrar: el de la API (ya en español) o uno genérico. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

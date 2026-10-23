import { z } from 'zod';

// Cliente de la API (specs/10). El navegador siempre llama a /api del mismo origen: Next.js lo
// reenvía a pv-api (specs/PREGUNTAS.md #24), así la cookie de refresh es del mismo sitio.

const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NETWORK_MESSAGE =
  'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON, o un archivo (Blob) que se envía tal cual con su tipo (subir el logo). */
  body?: unknown;
  /** No intentar renovar la sesión ante un 401 (rutas de auth). */
  noRetry?: boolean;
};

export type ApiClientOptions = {
  /** Access token vigente, o null. */
  getToken: () => string | null;
  /** Renueva la sesión; devuelve el nuevo token o null si ya no hay sesión. */
  refresh: () => Promise<string | null>;
  fetch?: typeof fetch;
  baseUrl?: string;
};

export type ApiClient = <S extends z.ZodType>(
  path: string,
  schema: S,
  options?: RequestOptions,
) => Promise<z.output<S>>;

/** Respuesta sin cuerpo (204). */
export const noContent = z.undefined();

async function send(
  fetchFn: typeof fetch,
  url: string,
  token: string | null,
  options: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const file = options.body instanceof Blob ? options.body : null;
  if (file) headers['Content-Type'] = file.type || 'application/octet-stream';
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetchFn(url, {
      method: options.method ?? 'GET',
      headers,
      body: file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }
}

async function toError(res: Response): Promise<ApiError> {
  const parsed = errorBody.safeParse(await res.json().catch(() => null));
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiError(res.status, e.code, e.message, e.details);
  }
  return new ApiError(res.status, 'HTTP_ERROR', 'Ocurrió un error inesperado. Inténtalo de nuevo.');
}

/**
 * Crea el cliente: agrega el token, ante un 401 renueva la sesión una vez y reintenta, y valida
 * cada respuesta con su esquema zod (borde HTTP del lado del navegador).
 */
export function createApiClient(opts: ApiClientOptions): ApiClient {
  const fetchFn = opts.fetch ?? fetch.bind(globalThis);
  const base = opts.baseUrl ?? '/api';
  return async (path, schema, options = {}) => {
    const url = `${base}${path}`;
    let res = await send(fetchFn, url, opts.getToken(), options);
    if (res.status === 401 && !options.noRetry) {
      const token = await opts.refresh();
      if (token) res = await send(fetchFn, url, token, options);
    }
    if (!res.ok) throw await toError(res);
    const body: unknown = res.status === 204 ? undefined : await res.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(res.status, 'INVALID_RESPONSE', 'La respuesta del servidor no es válida.');
    }
    return parsed.data;
  };
}

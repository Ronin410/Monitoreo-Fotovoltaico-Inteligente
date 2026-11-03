import { z } from 'zod';
import { NotImplementedError, type InverterAdapter } from './types.js';

// Adaptador de Victron Energy (VRM API v2). Implementado SOLO con la documentación oficial
// (docs/fabricantes/victron-vrm.md, revisada el 2026-11-03):
// - Dirección base https://vrmapi.victronenergy.com/v2.
// - Autenticación con token de acceso: encabezado `x-authorization: Token <token>` (el formato
//   Bearer es obsoleto desde el 1 de junio de 2026).
// - Respuestas con `success`; errores con `errors` y `error_code`.
// - Límite: ventana móvil de 200 peticiones (~3 por segundo); al excederlo responde 429 con
//   `Retry-After` en segundos.
// La lectura de la serie (`/installations/{idSite}/stats`) todavía no se implementa: la
// documentación no dice qué códigos trae la producción FV, si cada punto es energía o potencia,
// ni la unidad de sus timestamps (specs/PREGUNTAS.md #212). `pnpm victron:probe` obtiene esas
// respuestas con una cuenta real.

export const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';

/** Credenciales de una planta Victron: token de acceso de VRM e id de la instalación. */
export const victronCredentialsSchema = z.object({
  access_token: z.string().trim().min(10).max(2000),
  id_site: z.coerce.number().int().positive(),
});
export type VictronCredentials = z.infer<typeof victronCredentialsSchema>;

const errorBody = z.object({
  success: z.literal(false),
  errors: z.unknown().optional(),
  error_code: z.string().nullable().optional(),
});

const meResponse = z.object({
  success: z.literal(true),
  user: z.object({ id: z.number().int() }),
});

const installationsResponse = z.object({
  success: z.literal(true),
  records: z.array(
    z.object({
      idSite: z.number().int(),
      name: z.string(),
      pvMax: z.number(),
      timezone: z.string(),
    }),
  ),
});
export type VrmInstallation = z.infer<typeof installationsResponse>['records'][number];

/** Error de VRM: código HTTP y `error_code`, nunca el token ni el texto del proveedor. */
export class VrmApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    /** Segundos que pide esperar `Retry-After` (solo en 429). */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`VRM respondió ${status}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'VrmApiError';
  }
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

export type VrmClientOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string };

export class VrmClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(
    private readonly accessToken: string,
    options: VrmClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.baseUrl = options.baseUrl ?? VRM_BASE_URL;
  }

  /** GET a la API; devuelve el JSON sin interpretar (lo valida quien llama). */
  async get(
    path: string,
    query: Record<string, string | number | string[]> = {},
  ): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      for (const item of Array.isArray(v) ? v : [v]) params.append(k, String(item));
    }
    const qs = params.toString();
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs ? `?${qs}` : ''}`, {
      headers: { 'x-authorization': `Token ${this.accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const retry = Number(res.headers.get('Retry-After'));
      throw new VrmApiError(
        res.status,
        errorBody.safeParse(body).data?.error_code ?? null,
        res.status === 429 && Number.isFinite(retry) ? retry : null,
      );
    }
    const failed = errorBody.safeParse(body);
    if (failed.success) throw new VrmApiError(res.status, failed.data.error_code ?? null);
    return body;
  }

  /** Usuario dueño del token (`GET /users/me`). */
  async me(): Promise<{ id: number }> {
    return meResponse.parse(await this.get('/users/me')).user;
  }

  /** La instalación indicada, si el usuario tiene acceso a ella; si no, null. */
  async installation(idUser: number, idSite: number): Promise<VrmInstallation | null> {
    const res = installationsResponse.parse(
      await this.get(`/users/${idUser}/installations`, { idSite }),
    );
    return res.records.find((r) => r.idSite === idSite) ?? null;
  }
}

export const victronAdapter: InverterAdapter = {
  provider: 'victron',
  credentialsSchema: victronCredentialsSchema,
  async testConnection(creds) {
    const parsed = victronCredentialsSchema.safeParse(creds);
    if (!parsed.success)
      return { ok: false, message: 'Faltan el token de acceso o la instalación' };
    const client = new VrmClient(parsed.data.access_token);
    const user = await client.me();
    const site = await client.installation(user.id, parsed.data.id_site);
    return site
      ? { ok: true }
      : { ok: false, message: 'El token no tiene acceso a esa instalación' };
  },
  async fetchReadings() {
    throw new NotImplementedError(
      'Victron: falta confirmar con una cuenta real los códigos y unidades de la serie (specs/PREGUNTAS.md #212)',
    );
  },
};

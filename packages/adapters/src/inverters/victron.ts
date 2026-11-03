import { z } from 'zod';
import type { InverterAdapter, RawReading } from './types.js';

// Adaptador de Victron Energy (VRM API v2). Implementado SOLO con la documentación oficial
// (docs/fabricantes/victron-vrm.md, revisada el 2026-11-03):
// - Dirección base https://vrmapi.victronenergy.com/v2.
// - Autenticación con token de acceso: encabezado `x-authorization: Token <token>` (el formato
//   Bearer es obsoleto desde el 1 de junio de 2026).
// - Respuestas con `success`; errores con `errors` y `error_code`.
// - Límite: ventana móvil de 200 peticiones (~3 por segundo); al excederlo responde 429 con
//   `Retry-After` en segundos.
// Serie de producción (`GET /installations/{idSite}/stats`). Lo que la documentación no decía se
// confirmó con respuestas reales de la instalación demo de VRM (docs/fabricantes/victron-vrm.md §7,
// specs/PREGUNTAS.md #216):
// - `start` y `end` van en SEGUNDOS; los timestamps de la respuesta, en MILISEGUNDOS.
// - Con `interval=15mins`, cada punto empieza en `start + n × 15 min`: su timestamp es el INICIO
//   del intervalo.
// - `type=live_feed` trae `total_solar_yield`: ENERGÍA solar del intervalo en kWh (suma exacta de
//   lo que va a batería, red y consumo). Sin producción no hay punto.
// - Máximo 31 días por consulta.

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
  async fetchReadings({ creds, since, until }) {
    const c = victronCredentialsSchema.parse(creds);
    return fetchSolarYield(new VrmClient(c.access_token), c.id_site, since, until);
  },
};

const INTERVAL_MS = 15 * 60 * 1000;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/** Una serie de stats: puntos [timestamp ms, promedio, mín?, máx?], o false si no hay datos. */
const statsSeries = z.union([z.array(z.array(z.number()).min(2)), z.literal(false)]);
const liveFeedResponse = z.object({
  success: z.literal(true),
  // Sin ninguna serie, PHP puede devolver una lista vacía en lugar de un objeto.
  records: z.union([
    z.object({ total_solar_yield: statsSeries.optional() }).loose(),
    z.array(z.never()).length(0),
  ]),
});

/**
 * Energía solar de cada 15 min entre `since` y `until`, como potencia media (kWh × 4 = kW). Se
 * pide desde el cuarto de hora para que los intervalos de VRM coincidan con los nuestros, y se
 * descarta el que todavía no termina.
 */
export async function fetchSolarYield(
  client: VrmClient,
  idSite: number,
  since: Date,
  until: Date,
): Promise<RawReading[]> {
  const out: RawReading[] = [];
  let from = Math.floor(since.getTime() / INTERVAL_MS) * INTERVAL_MS;
  const to = until.getTime();
  while (from < to) {
    const chunkEnd = Math.min(to, from + MAX_WINDOW_MS);
    const res = liveFeedResponse.parse(
      await client.get(`/installations/${idSite}/stats`, {
        type: 'live_feed',
        interval: '15mins',
        start: Math.floor(from / 1000),
        end: Math.floor(chunkEnd / 1000),
      }),
    );
    const series = Array.isArray(res.records) ? false : (res.records.total_solar_yield ?? false);
    for (const [ts, kwh] of series || []) {
      if (ts === undefined || kwh === undefined) continue;
      if (ts < from || ts + INTERVAL_MS > chunkEnd) continue; // intervalo incompleto o ajeno
      out.push({ ts: new Date(ts), powerKw: Math.max(0, kwh) * 4 });
    }
    from = chunkEnd;
  }
  return out;
}

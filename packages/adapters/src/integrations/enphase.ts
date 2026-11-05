import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RawReading } from '../inverters/types.js';

// Cliente de la API v4 de Enphase (Monitoring API) para una instaladora con plan Partner.
// Implementado SOLO con la documentación oficial (docs/fabricantes/enphase-api-v4.md y la
// especificación del portal guardada en docs/fabricantes/enphase-monitoring-api-v4.json):
// - Token: POST https://api.enphaseenergy.com/oauth/token, Basic base64(client_id:client_secret),
//   cuerpo application/x-www-form-urlencoded con grant_type=password, username y password (la
//   cuenta de Enlighten de la instaladora). El access_token dura 1 día.
// - Cada petición: `Authorization: Bearer <access_token>` y el encabezado `key` con la API key.
// - Límites del plan Partner: 300 por minuto; al excederlo responde 429.
// - telemetry/production_micro con granularity=day: hasta 288 intervalos de 5 min desde start_at
//   (epoch en segundos). Cada intervalo trae `end_at` (FIN del intervalo), `powr` (W medios) y
//   `enwh` (Wh).
// Decisión del PO (specs/PREGUNTAS.md #223 y #224): se guardan cifradas las llaves de la
// aplicación y la cuenta de Enlighten, y se lee cada 2 horas.

export const ENPHASE_BASE_URL = 'https://api.enphaseenergy.com';

/** Llaves de la aplicación Partner y cuenta de Enlighten. Se guardan cifradas (company_integrations). */
export const enphaseCredentialsSchema = z.object({
  api_key: z.string().trim().min(1).max(500),
  client_id: z.string().trim().min(1).max(200),
  client_secret: z.string().trim().min(1).max(500),
  username: z.email().trim().max(320),
  password: z.string().min(1).max(500),
});
export type EnphaseCredentials = z.infer<typeof enphaseCredentialsSchema>;

/** Lo que se guarda en cada planta: el número de sistema de Enphase. */
export const enphasePlantCredentialsSchema = z.object({
  system_id: z.coerce.number().int().positive(),
});

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const systemsResponse = z.object({
  total: z.number().int(),
  systems: z.array(z.object({ system_id: z.number().int(), name: z.string() }).loose()),
});

const microTelemetry = z.object({
  system_id: z.number().int(),
  intervals: z.array(
    z.object({
      end_at: z.number().int(),
      powr: z.number().nullable().optional(),
      enwh: z.number().nullable().optional(),
    }),
  ),
});
export type EnphaseMicroTelemetry = z.infer<typeof microTelemetry>;

/** Error de Enphase con su código HTTP; nunca incluye las llaves ni el mensaje del proveedor. */
export class EnphaseApiError extends Error {
  constructor(readonly status: number) {
    super(`Enphase respondió HTTP ${status}`);
    this.name = 'EnphaseApiError';
  }
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

export type EnphaseClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  baseUrl?: string;
};

/** Se renueva una hora antes de que venza. */
const RENEW_BEFORE_MS = 60 * 60 * 1000;

/**
 * Tokens en memoria del proceso, por cuenta (llave = hash de las credenciales), para no pedir uno
 * en cada planta. Se guarda la promesa para que las lecturas en paralelo compartan la misma.
 */
const tokenCache = new Map<string, { value: Promise<string>; renewAt: number }>();

export function clearEnphaseTokenCache(): void {
  tokenCache.clear();
}

export class EnphaseClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly cacheKey: string;

  constructor(
    private readonly creds: EnphaseCredentials,
    options: EnphaseClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.baseUrl = options.baseUrl ?? ENPHASE_BASE_URL;
    this.cacheKey = createHash('sha256')
      .update(JSON.stringify([this.baseUrl, creds.client_id, creds.username, creds.password]))
      .digest('hex');
  }

  private async requestToken(): Promise<{ token: string; expiresInMs: number }> {
    const basic = Buffer.from(`${this.creds.client_id}:${this.creds.client_secret}`).toString(
      'base64',
    );
    const res = await this.fetchImpl(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.creds.username,
        password: this.creds.password,
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new EnphaseApiError(res.status);
    const parsed = tokenResponse.parse(await res.json());
    return { token: parsed.access_token, expiresInMs: parsed.expires_in * 1000 };
  }

  private accessToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (cached && this.now() < cached.renewAt) return cached.value;
    const entry = { value: Promise.resolve(''), renewAt: Number.POSITIVE_INFINITY };
    entry.value = this.requestToken().then(
      ({ token, expiresInMs }) => {
        entry.renewAt = this.now() + Math.max(0, expiresInMs - RENEW_BEFORE_MS);
        return token;
      },
      (err: unknown) => {
        if (tokenCache.get(this.cacheKey) === entry) tokenCache.delete(this.cacheKey);
        throw err;
      },
    );
    tokenCache.set(this.cacheKey, entry);
    return entry.value;
  }

  /** GET a la API; con 401 pide un token nuevo una vez y repite. */
  private async get(path: string, retried = false): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, key: this.creds.api_key },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 401 && !retried) {
      tokenCache.delete(this.cacheKey);
      return this.get(path, true);
    }
    if (!res.ok) throw new EnphaseApiError(res.status);
    return res.json();
  }

  /** "Probar conexión": obtiene el token y lee la primera página de sistemas. */
  async testConnection(): Promise<{ ok: true; systems: number }> {
    const page = systemsResponse.parse(await this.get('/api/v4/systems?page=1&size=1'));
    return { ok: true, systems: page.total };
  }

  /** ¿La cuenta ve ese sistema? */
  async hasSystem(systemId: number): Promise<boolean> {
    try {
      await this.get(`/api/v4/systems/${systemId}`);
      return true;
    } catch (err) {
      if (err instanceof EnphaseApiError && (err.status === 403 || err.status === 404)) {
        return false;
      }
      throw err;
    }
  }

  /** Producción de los microinversores: hasta un día de intervalos de 5 min desde `startAt`. */
  async productionMicro(systemId: number, startAt: Date): Promise<EnphaseMicroTelemetry> {
    const start = Math.floor(startAt.getTime() / 1000);
    return microTelemetry.parse(
      await this.get(
        `/api/v4/systems/${systemId}/telemetry/production_micro?start_at=${start}&granularity=day`,
      ),
    );
  }
}

const FIVE_MIN_MS = 5 * 60 * 1000;
const INTERVAL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Tope de consultas por lectura: la ingesta mira hasta 7 días atrás. */
const MAX_REQUESTS = 8;

/**
 * Producción de cada 15 min entre `since` y `until`, como potencia media (kW). Suma la energía de
 * los tres intervalos de 5 min de cada cuarto de hora (Wh / 1000 × 4); un cuarto de hora al que
 * le falte alguno de los tres no se entrega, para no confundir un hueco con producción baja.
 */
export async function fetchEnphaseProduction(
  client: EnphaseClient,
  systemId: number,
  since: Date,
  until: Date,
): Promise<RawReading[]> {
  const buckets = new Map<number, { wh: number; parts: number }>();
  const seen = new Set<number>();
  let start = Math.floor(since.getTime() / INTERVAL_MS) * INTERVAL_MS;
  for (let i = 0; i < MAX_REQUESTS && start < until.getTime(); i++) {
    const { intervals } = await client.productionMicro(systemId, new Date(start));
    let lastEnd = start;
    for (const iv of intervals) {
      const endMs = iv.end_at * 1000;
      lastEnd = Math.max(lastEnd, endMs);
      if (iv.enwh == null || endMs > until.getTime() || seen.has(endMs)) continue;
      seen.add(endMs);
      const key = Math.floor((endMs - FIVE_MIN_MS) / INTERVAL_MS) * INTERVAL_MS;
      const b = buckets.get(key) ?? { wh: 0, parts: 0 };
      buckets.set(key, { wh: b.wh + iv.enwh, parts: b.parts + 1 });
    }
    // Sin datos ese día (por ejemplo, sin comunicación): se sigue con el día siguiente.
    start = lastEnd > start ? lastEnd : start + DAY_MS;
  }
  return [...buckets.entries()]
    .filter(([, b]) => b.parts >= 3)
    .sort(([a], [b]) => a - b)
    .map(([key, b]) => ({ ts: new Date(key), powerKw: Math.round(b.wh * 4) / 1000 }));
}

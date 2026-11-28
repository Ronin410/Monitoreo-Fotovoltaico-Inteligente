import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RawReading } from '../inverters/types.js';

// Cliente de la OpenAPI de GoodWe (SEMS) para una instaladora con acceso de "usuario de
// organización". Implementado SOLO con la documentación oficial (docs/fabricantes/goodwe-openapi.md):
// - Token por OAuth 2.0 client credentials: POST {servidor}/goodwe/goodwe-authorization-server/
//   oauth2/token, Basic base64(client_id:client_secret), grant_type=client_credentials. Dura
//   3,600 s y GoodWe recomienda renovarlo a los ~50 min. Solo hay un token activo por Client ID:
//   pedir uno nuevo invalida el anterior.
// - Funciones: POST con JSON, encabezados `Authorization: Bearer` y `Request-Id` (obligatorio; su
//   formato no está documentado: se manda un UUID nuevo por petición, specs/PREGUNTAS.md #213).
// - Respuesta { code, msg, data }; "00000" es éxito. 00003 = límite de frecuencia; 10002 = token
//   vencido.
// - Serie de la planta (`realtime/plants/history`): hasta 100 plantas, 24 h por consulta, un punto
//   por minuto; `startTime`/`endTime` y `timeStamp` en SEGUNDOS UTC; `pvPower` en kW (anexo
//   "Station Telemetry Points"). La documentación se contradice en la forma de `plantData` (el
//   esquema dice lista y el ejemplo, objeto con el plantId como llave) y en el tipo de los valores
//   (número o texto): se aceptan las dos formas documentadas (specs/PREGUNTAS.md #227).

export const GOODWE_SERVERS = {
  eu: 'https://eu-gateway.semsportal.com',
  us: 'https://us-gateway.semsportal.com',
  au: 'https://au-gateway.semsportal.com',
  hk: 'https://hk-gateway.semsportal.com',
  cn: 'https://gateway.sems.com.cn',
} as const;
export type GoodweRegion = keyof typeof GOODWE_SERVERS;

/** Llaves que GoodWe entrega a la instaladora. Se guardan cifradas (company_integrations). */
export const goodweCredentialsSchema = z.object({
  client_id: z.string().trim().min(1).max(200),
  client_secret: z.string().trim().min(1).max(500),
  region: z.enum(Object.keys(GOODWE_SERVERS) as [GoodweRegion, ...GoodweRegion[]]),
});
export type GoodweCredentials = z.infer<typeof goodweCredentialsSchema>;

/** Lo que se guarda en cada planta: su ID de planta en SEMS (`plantId`). */
export const goodwePlantCredentialsSchema = z.object({
  plant_id: z.string().trim().min(1).max(100),
});

const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
});

const envelope = z.object({
  code: z.string(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
});

const plantsData = z.object({
  plantRecord: z.number(),
  pageIndex: z.number(),
  pageSize: z.number(),
  plantData: z.array(
    z.object({
      plantId: z.string(),
      plantName: z.string(),
      plantStatus: z.number(),
      pvCapacity: z.number(),
    }),
  ),
});
export type GoodwePlantsPage = z.infer<typeof plantsData>;

/** Número que la documentación muestra a veces como número y a veces como texto ("0.001"). */
const looseNumber = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

const historyPlant = z.object({
  plantId: z.string(),
  historicalData: z
    .array(z.object({ timeStamp: looseNumber, pvPower: looseNumber.nullable().optional() }).loose())
    .nullable()
    .optional(),
});
/** `plantData` como lista (esquema) o como objeto con el plantId como llave (ejemplo). */
const historyData = z.object({
  plantData: z.union([z.array(historyPlant), z.record(z.string(), historyPlant)]).nullable(),
  noPermissionSearchKey: z.array(z.string()).nullable().optional(),
});

export type GoodwePowerPoint = { ts: Date; pvPowerKw: number };

/** Error de GoodWe con su código; nunca incluye las llaves ni el mensaje del proveedor. */
export class GoodweApiError extends Error {
  constructor(readonly code: string) {
    super(`GoodWe respondió el código ${code}`);
    this.name = 'GoodweApiError';
  }
  /** 00003: se excedió el límite de frecuencia; el job debe reintentar más tarde. */
  get rateLimited(): boolean {
    return this.code === '00003';
  }
}

const TOKEN_EXPIRED = '10002';
/** Se renueva 10 minutos antes de que venza (GoodWe sugiere a los ~50 de 60 min). */
const RENEW_BEFORE_MS = 10 * 60 * 1000;

export type GoodweClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * Tokens en memoria del proceso, por cuenta. GoodWe permite un solo token activo por Client ID
 * (pedir otro invalida el anterior), así que todas las plantas de la instaladora comparten el
 * mismo; se guarda la promesa para que las lecturas en paralelo no pidan uno cada una.
 */
const tokenCache = new Map<string, { value: Promise<string>; renewAt: number }>();

export function clearGoodweTokenCache(): void {
  tokenCache.clear();
}

export class GoodweClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheKey: string;

  constructor(
    private readonly creds: GoodweCredentials,
    options: GoodweClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cacheKey = createHash('sha256')
      .update(JSON.stringify([creds.region, creds.client_id, creds.client_secret]))
      .digest('hex');
  }

  private get baseUrl(): string {
    return GOODWE_SERVERS[this.creds.region];
  }

  private accessToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (cached && this.now() < cached.renewAt) return cached.value;
    const entry = { value: Promise.resolve(''), renewAt: Number.POSITIVE_INFINITY };
    entry.value = this.requestToken().then(
      ({ value, expiresInMs }) => {
        entry.renewAt = this.now() + Math.max(0, expiresInMs - RENEW_BEFORE_MS);
        return value;
      },
      (err: unknown) => {
        if (tokenCache.get(this.cacheKey) === entry) tokenCache.delete(this.cacheKey);
        throw err;
      },
    );
    tokenCache.set(this.cacheKey, entry);
    return entry.value;
  }

  private async requestToken(): Promise<{ value: string; expiresInMs: number }> {
    const basic = Buffer.from(`${this.creds.client_id}:${this.creds.client_secret}`).toString(
      'base64',
    );
    const res = await this.fetchImpl(
      `${this.baseUrl}/goodwe/goodwe-authorization-server/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!res.ok) throw new GoodweApiError(`HTTP_${res.status}`);
    const token = tokenResponse.parse(await res.json());
    return { value: token.access_token, expiresInMs: token.expires_in * 1000 };
  }

  /** POST a una función de la API; con el token vencido lo renueva una vez y repite. */
  private async call(path: string, body: unknown, retried = false): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Request-Id': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const parsed = envelope.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new GoodweApiError(`HTTP_${res.status}`);
    if (parsed.data.code === TOKEN_EXPIRED && !retried) {
      tokenCache.delete(this.cacheKey);
      return this.call(path, body, true);
    }
    if (parsed.data.code !== '00000') throw new GoodweApiError(parsed.data.code);
    return parsed.data.data;
  }

  /** Plantas de la cuenta (base-info/plants), página por página (10 a 100 por página). */
  async listPlants(
    page: { pageIndex: number; pageSize: 10 | 20 | 30 | 50 | 100 } = {
      pageIndex: 1,
      pageSize: 10,
    },
  ): Promise<GoodwePlantsPage> {
    return plantsData.parse(await this.call('/goodwe/integration/api/v1/base-info/plants', page));
  }

  /**
   * Serie de potencia de las plantas (`realtime/plants/history`), hasta 24 h. Devuelve los puntos
   * por plantId y las plantas que la cuenta no puede ver.
   */
  async plantsPowerHistory(
    plantIds: string[],
    start: Date,
    end: Date,
  ): Promise<{ points: Map<string, GoodwePowerPoint[]>; noPermission: string[] }> {
    const data = historyData.parse(
      await this.call('/goodwe/integration/api/v1/realtime/plants/history', {
        searchKey: plantIds,
        searchType: 1,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        interval: 1,
        dataPoints: ['pvPower'],
      }),
    );
    const plants = Array.isArray(data.plantData)
      ? data.plantData
      : Object.values(data.plantData ?? {});
    const points = new Map<string, GoodwePowerPoint[]>();
    for (const plant of plants) {
      points.set(
        plant.plantId,
        (plant.historicalData ?? [])
          .filter((p) => p.pvPower != null)
          .map((p) => ({ ts: new Date(p.timeStamp * 1000), pvPowerKw: p.pvPower as number })),
      );
    }
    return { points, noPermission: data.noPermissionSearchKey ?? [] };
  }

  /** "Probar conexión": obtiene el token y lee la primera página de plantas. */
  async testConnection(): Promise<{ ok: true; plants: number }> {
    const page = await this.listPlants();
    return { ok: true, plants: page.plantRecord };
  }
}

const MINUTE_MS = 60_000;
const INTERVAL_MS = 15 * MINUTE_MS;
const WINDOW_MS = 24 * 60 * MINUTE_MS;
/** Tope de consultas por lectura: la ingesta mira hasta 7 días atrás. */
const MAX_REQUESTS = 8;

/**
 * Potencia de una planta entre `since` y `until`, un punto por minuto (kW). La ingesta promedia
 * los minutos de cada cuarto de hora. Se pide desde el cuarto de hora, en ventanas de 24 h, y se
 * descarta el cuarto de hora que todavía no termina.
 */
export async function fetchGoodweProduction(
  client: GoodweClient,
  plantId: string,
  since: Date,
  until: Date,
): Promise<RawReading[]> {
  const lastComplete = Math.floor(until.getTime() / INTERVAL_MS) * INTERVAL_MS;
  let start = Math.floor(since.getTime() / INTERVAL_MS) * INTERVAL_MS;
  const readings: RawReading[] = [];
  for (let i = 0; i < MAX_REQUESTS && start < lastComplete; i++) {
    const end = Math.min(start + WINDOW_MS, lastComplete);
    const { points, noPermission } = await client.plantsPowerHistory(
      [plantId],
      new Date(start),
      new Date(end),
    );
    if (noPermission.includes(plantId)) throw new GoodweApiError('21201');
    for (const p of points.get(plantId) ?? []) {
      const t = p.ts.getTime();
      if (t >= start && t < end) readings.push({ ts: p.ts, powerKw: p.pvPowerKw });
    }
    start = end;
  }
  return readings.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

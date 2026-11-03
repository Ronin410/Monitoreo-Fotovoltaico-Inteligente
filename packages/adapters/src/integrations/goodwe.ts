import { randomUUID } from 'node:crypto';
import { z } from 'zod';

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
// La lectura de la serie de potencia todavía no se implementa: la documentación se contradice en
// su formato y hay que confirmarlo con una cuenta real (docs/fabricantes/goodwe-openapi.md §6).

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

export class GoodweClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private token: { value: string; renewAt: number } | null = null;

  constructor(
    private readonly creds: GoodweCredentials,
    options: GoodweClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private get baseUrl(): string {
    return GOODWE_SERVERS[this.creds.region];
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.renewAt) return this.token.value;
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
    this.token = {
      value: token.access_token,
      renewAt: this.now() + Math.max(0, token.expires_in * 1000 - RENEW_BEFORE_MS),
    };
    return token.access_token;
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
      this.token = null;
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

  /** "Probar conexión": obtiene el token y lee la primera página de plantas. */
  async testConnection(): Promise<{ ok: true; plants: number }> {
    const page = await this.listPlants();
    return { ok: true, plants: page.plantRecord };
  }
}

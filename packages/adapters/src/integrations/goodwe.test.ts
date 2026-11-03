import { describe, expect, it } from 'vitest';
import { GoodweApiError, GoodweClient, goodweCredentialsSchema } from './goodwe.js';

// Respuestas tomadas de los ejemplos de la documentación oficial (docs/fabricantes/goodwe-openapi.md).

const creds = goodweCredentialsSchema.parse({
  client_id: 'cliente-instaladora',
  client_secret: 'secreto-instaladora',
  region: 'us',
});

const PLANTS_EXAMPLE = {
  code: '00000',
  msg: 'Request has been processed successfully',
  data: {
    plantRecord: 1,
    pageIndex: 1,
    pageSize: 10,
    plantData: [
      {
        plantId: '11f70476-bd61-48aa-b86d-40f87808dcc8',
        plantName: 'Test Open Api',
        distributorCode: 'GW000000',
        plantType: 0,
        plantStatus: 1,
        plantNmi: '',
        timeZone: 5.0,
        createTime: '1778138590777',
        pvCapacity: 15.0,
        batteryCapacity: 0.0,
      },
    ],
    noPermissionSearchKey: [],
  },
};

type Call = { url: string; init: RequestInit };

function fakeFetch(replies: ((call: Call) => unknown)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const reply = replies.shift();
    if (!reply) throw new Error('llamada inesperada');
    const body = reply(call);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const token =
  (value = 'tok-1') =>
  () => ({
    access_token: value,
    token_type: 'Bearer',
    expires_in: 3600,
  });

describe('cliente de GoodWe', () => {
  it('pide el token con client credentials y lista las plantas con Bearer y Request-Id', async () => {
    const { fetchImpl, calls } = fakeFetch([token(), () => PLANTS_EXAMPLE]);
    const client = new GoodweClient(creds, { fetchImpl });
    const page = await client.listPlants();
    expect(page.plantRecord).toBe(1);
    expect(page.plantData[0]).toMatchObject({ plantName: 'Test Open Api', pvCapacity: 15 });

    const [tokenCall, plantsCall] = calls;
    expect(tokenCall?.url).toBe(
      'https://us-gateway.semsportal.com/goodwe/goodwe-authorization-server/oauth2/token',
    );
    const tokenHeaders = tokenCall?.init.headers as Record<string, string>;
    expect(tokenHeaders.Authorization).toBe(
      `Basic ${Buffer.from('cliente-instaladora:secreto-instaladora').toString('base64')}`,
    );
    expect(tokenCall?.init.body).toBe('grant_type=client_credentials');

    expect(plantsCall?.url).toBe(
      'https://us-gateway.semsportal.com/goodwe/integration/api/v1/base-info/plants',
    );
    const headers = plantsCall?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(plantsCall?.init.body))).toEqual({ pageIndex: 1, pageSize: 10 });
  });

  it('reutiliza el token hasta 10 minutos antes de que venza', async () => {
    let now = 0;
    const { fetchImpl, calls } = fakeFetch([
      token('tok-1'),
      () => PLANTS_EXAMPLE,
      () => PLANTS_EXAMPLE,
      token('tok-2'),
      () => PLANTS_EXAMPLE,
    ]);
    const client = new GoodweClient(creds, { fetchImpl, now: () => now });
    await client.listPlants();
    now = 49 * 60_000;
    await client.listPlants();
    now = 51 * 60_000;
    await client.listPlants();
    const auth = calls
      .filter((c) => c.url.includes('base-info'))
      .map((c) => (c.init.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2']);
  });

  it('con el token vencido (10002) lo renueva una vez y repite', async () => {
    const { fetchImpl } = fakeFetch([
      token('tok-1'),
      () => ({ code: '10002', msg: 'AccessToken has expired' }),
      token('tok-2'),
      () => PLANTS_EXAMPLE,
    ]);
    const page = await new GoodweClient(creds, { fetchImpl }).listPlants();
    expect(page.plantRecord).toBe(1);
  });

  it('un código de error se reporta sin el mensaje del proveedor; 00003 es límite de frecuencia', async () => {
    const { fetchImpl } = fakeFetch([token(), () => ({ code: '00003', msg: 'x' })]);
    const err = await new GoodweClient(creds, { fetchImpl }).listPlants().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoodweApiError);
    expect((err as GoodweApiError).rateLimited).toBe(true);
    expect((err as Error).message).not.toContain('secreto');
  });

  it('valida las llaves que captura la instaladora', () => {
    expect(goodweCredentialsSchema.safeParse({ ...creds, region: 'mx' }).success).toBe(false);
    expect(goodweCredentialsSchema.safeParse({ ...creds, client_secret: ' ' }).success).toBe(false);
  });
});

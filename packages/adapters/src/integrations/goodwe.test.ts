import { beforeEach, describe, expect, it } from 'vitest';
import { goodweAdapter } from '../inverters/goodwe.js';
import {
  clearGoodweTokenCache,
  fetchGoodweProduction,
  GoodweApiError,
  GoodweClient,
  goodweCredentialsSchema,
} from './goodwe.js';

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

beforeEach(() => clearGoodweTokenCache());

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

/** Ejemplo oficial de realtime/plants/history: plantData como objeto y valores como texto. */
const HISTORY_EXAMPLE = {
  code: '00000',
  data: {
    noPermissionSearchKey: [],
    plantData: {
      'e06b4c57-5d95-4467-a053-fc234c2acb47': {
        plantId: 'e06b4c57-5d95-4467-a053-fc234c2acb47',
        plantName: '15a Beauty Point Road',
        nmi: null,
        historicalData: [
          { timeStamp: '1782285720', meterPower: '0', batteryPower: '1.21472', pvPower: '0.001' },
          { timeStamp: '1782285780', meterPower: '0', batteryPower: '1.21488', pvPower: '0' },
        ],
      },
    },
  },
  msg: 'Request has been processed successfully',
};
const PLANT = 'e06b4c57-5d95-4467-a053-fc234c2acb47';

/** Respuesta con la forma del esquema oficial (plantData como lista y valores numéricos). */
function historyAsList(points: { timeStamp: number; pvPower: number | null }[], plantId = PLANT) {
  return {
    code: '00000',
    data: {
      noPermissionSearchKey: [],
      plantData: [{ plantId, plantName: 'Casa', nmi: null, historicalData: points }],
    },
    msg: 'ok',
  };
}

describe('serie de potencia de GoodWe', () => {
  it('acepta el ejemplo oficial: objeto por plantId y valores como texto', async () => {
    const { fetchImpl, calls } = fakeFetch([token(), () => HISTORY_EXAMPLE]);
    const start = new Date(1782285720 * 1000);
    const { points } = await new GoodweClient(creds, { fetchImpl }).plantsPowerHistory(
      [PLANT],
      start,
      new Date(start.getTime() + 3_600_000),
    );
    expect(points.get(PLANT)).toEqual([
      { ts: new Date(1782285720 * 1000), pvPowerKw: 0.001 },
      { ts: new Date(1782285780 * 1000), pvPowerKw: 0 },
    ]);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      searchKey: [PLANT],
      searchType: 1,
      startTime: 1782285720,
      endTime: 1782289320,
      interval: 1,
      dataPoints: ['pvPower'],
    });
  });

  it('acepta la forma del esquema: lista de plantas y valores numéricos', async () => {
    const { fetchImpl } = fakeFetch([
      token(),
      () => historyAsList([{ timeStamp: 1782285720, pvPower: 2.5 }]),
    ]);
    const { points } = await new GoodweClient(creds, { fetchImpl }).plantsPowerHistory(
      [PLANT],
      new Date(0),
      new Date(1),
    );
    expect(points.get(PLANT)).toEqual([{ ts: new Date(1782285720 * 1000), pvPowerKw: 2.5 }]);
  });

  it('lee por ventanas de 24 h desde el cuarto de hora y descarta el que no termina', async () => {
    const day = 86_400;
    const t0 = 1782259200; // 00:00 UTC, múltiplo de 15 min
    const { fetchImpl, calls } = fakeFetch([
      token(),
      () =>
        historyAsList([
          { timeStamp: t0, pvPower: 1 },
          { timeStamp: t0 + 60, pvPower: null },
        ]),
      () =>
        historyAsList([
          { timeStamp: t0 + day, pvPower: 2 },
          { timeStamp: t0 + day + 900, pvPower: 3 }, // cuarto de hora en curso: se descarta
        ]),
    ]);
    const readings = await fetchGoodweProduction(
      new GoodweClient(creds, { fetchImpl }),
      PLANT,
      new Date((t0 + 300) * 1000),
      new Date((t0 + day + 1000) * 1000),
    );
    expect(readings).toEqual([
      { ts: new Date(t0 * 1000), powerKw: 1 },
      { ts: new Date((t0 + day) * 1000), powerKw: 2 },
    ]);
    const windows = calls.slice(1).map((c) => {
      const b = JSON.parse(String(c.init.body)) as { startTime: number; endTime: number };
      return [b.startTime - t0, b.endTime - t0];
    });
    expect(windows).toEqual([
      [0, day],
      [day, day + 900],
    ]);
  });

  it('una planta sin permiso falla sin repetir datos del proveedor', async () => {
    const { fetchImpl } = fakeFetch([
      token(),
      () => ({ code: '00000', data: { noPermissionSearchKey: [PLANT], plantData: [] }, msg: 'ok' }),
    ]);
    const t = Date.UTC(2026, 10, 1);
    const err = await fetchGoodweProduction(
      new GoodweClient(creds, { fetchImpl }),
      PLANT,
      new Date(t),
      new Date(t + 3_600_000),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoodweApiError);
    expect((err as GoodweApiError).code).toBe('21201');
  });

  it('las plantas comparten el token de la instaladora (GoodWe admite uno solo por Client ID)', async () => {
    const { fetchImpl, calls } = fakeFetch([
      token(),
      () => historyAsList([]),
      () => historyAsList([]),
    ]);
    const end = new Date(Date.UTC(2026, 10, 1));
    const start = new Date(end.getTime() - 3_600_000);
    await Promise.all([
      new GoodweClient(creds, { fetchImpl }).plantsPowerHistory([PLANT], start, end),
      new GoodweClient(creds, { fetchImpl }).plantsPowerHistory(['otra'], start, end),
    ]);
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(1);
  });
});

describe('goodweAdapter', () => {
  it('usa las llaves de la empresa y el ID de planta de SEMS', async () => {
    expect(goodweAdapter.usesCompanyIntegration).toBe(true);
    expect(goodweAdapter.credentialsSchema!.parse({ plant_id: ` ${PLANT} ` })).toEqual({
      plant_id: PLANT,
    });
    expect(await goodweAdapter.testConnection({ plant_id: PLANT }, undefined)).toEqual({
      ok: false,
      message: 'Falta conectar la cuenta de GoodWe de la empresa',
    });
  });
});

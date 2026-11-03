import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fetchSolarYield,
  VrmApiError,
  VrmClient,
  victronAdapter,
  victronCredentialsSchema,
} from './victron.js';

/** Respuesta real de `stats?type=live_feed&interval=15mins` (instalación demo de VRM, 6 horas). */
const LIVE_FEED = JSON.parse(
  readFileSync(new URL('./fixtures/victron-live-feed.json', import.meta.url), 'utf8'),
) as { records: { total_solar_yield: number[][] } };
const FIXTURE_START_MS = 1793728185000;

// Respuestas con la forma de la documentación oficial de la VRM API (docs/fabricantes/victron-vrm.md).

const TOKEN = 'token-de-acceso-vrm-123456';

function fakeFetch(
  replies: { status?: number; body: unknown; headers?: Record<string, string> }[],
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('llamada inesperada');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ME = { success: true, user: { id: 22, name: 'Instalador', email: 'x@y.mx', country: 'MX' } };
const INSTALLATIONS = {
  success: true,
  records: [
    {
      idSite: 151734,
      accessLevel: 1,
      owner: false,
      is_admin: true,
      name: 'Casa Pérez',
      identifier: 'c0619ab1d2e3',
      idUser: 30,
      pvMax: 5000,
      timezone: 'America/Mazatlan',
    },
  ],
};

describe('cliente de la VRM API', () => {
  it('manda el token en x-authorization con el formato Token', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: ME }, { body: INSTALLATIONS }]);
    const client = new VrmClient(TOKEN, { fetchImpl });
    const me = await client.me();
    const site = await client.installation(me.id, 151734);
    expect(site).toMatchObject({ idSite: 151734, timezone: 'America/Mazatlan' });
    expect(calls[0]?.url).toBe('https://vrmapi.victronenergy.com/v2/users/me');
    expect(calls[1]?.url).toBe(
      'https://vrmapi.victronenergy.com/v2/users/22/installations?idSite=151734',
    );
    expect((calls[0]?.init.headers as Record<string, string>)['x-authorization']).toBe(
      `Token ${TOKEN}`,
    );
  });

  it('429: reporta el límite y los segundos de Retry-After', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 429,
        body: { success: false, errors: 'Too many requests', error_code: null },
        headers: { 'Retry-After': '7' },
      },
    ]);
    const err = await new VrmClient(TOKEN, { fetchImpl }).me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VrmApiError);
    expect((err as VrmApiError).rateLimited).toBe(true);
    expect((err as VrmApiError).retryAfterSeconds).toBe(7);
  });

  it('un error no incluye el token ni el texto del proveedor', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 401,
        body: { success: false, errors: `bad ${TOKEN}`, error_code: 'invalid_token' },
      },
    ]);
    const err = (await new VrmClient(TOKEN, { fetchImpl }).me().catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('VRM respondió 401 (invalid_token)');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('adaptador Victron', () => {
  it('valida las credenciales: token e id de instalación', () => {
    expect(victronCredentialsSchema.parse({ access_token: TOKEN, id_site: '151734' })).toEqual({
      access_token: TOKEN,
      id_site: 151734,
    });
    expect(victronCredentialsSchema.safeParse({ access_token: TOKEN }).success).toBe(false);
  });

  it('lee la energía solar de cada 15 min de una respuesta real y la entrega como kW medios', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: LIVE_FEED }]);
    const client = new VrmClient(TOKEN, { fetchImpl });
    const since = new Date(FIXTURE_START_MS);
    const until = new Date(FIXTURE_START_MS + 6 * 3600_000);
    const readings = await fetchSolarYield(client, 219742, since, until);

    const points = LIVE_FEED.records.total_solar_yield;
    expect(readings).toHaveLength(points.length);
    expect(readings[0]).toEqual({
      ts: new Date(points[0]?.[0] ?? 0),
      powerKw: (points[0]?.[1] ?? 0) * 4,
    });
    // La energía se conserva: kW × 0.25 h = kWh de VRM.
    const kwh = readings.reduce((s, r) => s + r.powerKw * 0.25, 0);
    expect(kwh).toBeCloseTo(
      points.reduce((s, p) => s + (p[1] ?? 0), 0),
      10,
    );

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/v2/installations/219742/stats');
    expect(url.searchParams.get('type')).toBe('live_feed');
    expect(url.searchParams.get('interval')).toBe('15mins');
    // start alineado al cuarto de hora y en segundos.
    const start = Number(url.searchParams.get('start'));
    expect(start % 900).toBe(0);
    expect(start).toBeLessThanOrEqual(FIXTURE_START_MS / 1000);
    expect(Number(url.searchParams.get('end'))).toBe(until.getTime() / 1000);
  });

  it('descarta el intervalo en curso y acepta respuestas sin producción', async () => {
    const t0 = Date.UTC(2026, 10, 3, 18, 0);
    const { fetchImpl } = fakeFetch([
      {
        body: {
          success: true,
          records: {
            total_solar_yield: [
              [t0, 0.5],
              [t0 + 900_000, 0.25],
            ],
          },
          totals: {},
        },
      },
      { body: { success: true, records: [], totals: [] } },
      { body: { success: true, records: { total_solar_yield: false }, totals: {} } },
    ]);
    const client = new VrmClient(TOKEN, { fetchImpl });
    // until a la mitad del segundo intervalo: ese todavía no termina.
    const readings = await fetchSolarYield(client, 1, new Date(t0), new Date(t0 + 1_350_000));
    expect(readings).toEqual([{ ts: new Date(t0), powerKw: 2 }]);
    expect(await fetchSolarYield(client, 1, new Date(t0), new Date(t0 + 3600_000))).toEqual([]);
    expect(await fetchSolarYield(client, 1, new Date(t0), new Date(t0 + 3600_000))).toEqual([]);
  });

  it('parte las ventanas largas en tramos de 31 días', async () => {
    const empty = { body: { success: true, records: [], totals: [] } };
    const { fetchImpl, calls } = fakeFetch([empty, empty]);
    const since = new Date(Date.UTC(2026, 8, 1));
    const until = new Date(since.getTime() + 40 * 86_400_000);
    await fetchSolarYield(new VrmClient(TOKEN, { fetchImpl }), 1, since, until);
    expect(calls).toHaveLength(2);
    const span = (u: string) => {
      const q = new URL(u).searchParams;
      return Number(q.get('end')) - Number(q.get('start'));
    };
    expect(span(calls[0]?.url ?? '')).toBe(31 * 86_400);
  });

  it('testConnection sin credenciales completas responde un fallo genérico', async () => {
    expect(await victronAdapter.testConnection({ access_token: TOKEN })).toMatchObject({
      ok: false,
    });
  });
});

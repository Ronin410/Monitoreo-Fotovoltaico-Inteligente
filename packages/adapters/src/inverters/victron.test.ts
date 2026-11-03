import { describe, expect, it } from 'vitest';
import { NotImplementedError } from './types.js';
import { VrmApiError, VrmClient, victronAdapter, victronCredentialsSchema } from './victron.js';

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

  it('fetchReadings queda pendiente de confirmar códigos y unidades con una cuenta real', async () => {
    await expect(
      victronAdapter.fetchReadings({
        plant: {} as never,
        creds: {},
        since: new Date(),
        until: new Date(),
      }),
    ).rejects.toThrow(NotImplementedError);
  });

  it('testConnection sin credenciales completas responde un fallo genérico', async () => {
    expect(await victronAdapter.testConnection({ access_token: TOKEN })).toMatchObject({
      ok: false,
    });
  });
});

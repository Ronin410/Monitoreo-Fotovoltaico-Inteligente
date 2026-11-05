import { beforeEach, describe, expect, it } from 'vitest';
import { enphaseAdapter } from '../inverters/enphase.js';
import {
  clearEnphaseTokenCache,
  EnphaseApiError,
  EnphaseClient,
  enphaseCredentialsSchema,
  fetchEnphaseProduction,
} from './enphase.js';

// Respuestas con la forma de los ejemplos de la especificación oficial
// (docs/fabricantes/enphase-monitoring-api-v4.json); las cifras son de prueba.

const creds = enphaseCredentialsSchema.parse({
  api_key: 'llave-app',
  client_id: 'cliente-app',
  client_secret: 'secreto-app',
  username: 'operacion@instaladora.mx',
  password: 'Contraseña-Enlighten-77',
});

const TOKEN = {
  access_token: 'token-de-prueba',
  token_type: 'bearer',
  refresh_token: 'refresh-de-prueba',
  expires_in: 86393,
  scope: 'read write',
};

type Call = { url: string; init: RequestInit };

function fakeFetch(reply: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    const r = reply(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Respuesta de production_micro: intervalos de 5 min que TERMINAN en `end_at`. */
function micro(fromSec: number, count: number, enwh = 50) {
  return {
    system_id: 698905955,
    granularity: 'day',
    total_devices: 9,
    start_at: fromSec,
    end_at: fromSec + count * 300,
    items: 'intervals',
    intervals: Array.from({ length: count }, (_, i) => ({
      end_at: fromSec + (i + 1) * 300,
      devices_reporting: 9,
      powr: enwh * 12,
      enwh,
    })),
  };
}

const T0 = Date.parse('2026-11-05T18:00:00Z') / 1000;

beforeEach(() => clearEnphaseTokenCache());

describe('EnphaseClient', () => {
  it('pide el token con la cuenta de Enlighten y manda Bearer y key', async () => {
    const { calls, fetchImpl } = fakeFetch((c) =>
      c.url.endsWith('/oauth/token')
        ? { body: TOKEN }
        : { body: { total: 28, current_page: 1, size: 1, count: 1, systems: [] } },
    );
    const r = await new EnphaseClient(creds, { fetchImpl }).testConnection();
    expect(r).toEqual({ ok: true, systems: 28 });

    const [token, systems] = calls;
    expect(token!.url).toBe('https://api.enphaseenergy.com/oauth/token');
    expect(token!.init.method).toBe('POST');
    const headers = token!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('cliente-app:secreto-app').toString('base64')}`,
    );
    const body = new URLSearchParams(String(token!.init.body));
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('operacion@instaladora.mx');
    expect(body.get('password')).toBe('Contraseña-Enlighten-77');
    // La contraseña va en el cuerpo, nunca en la dirección.
    expect(token!.url).not.toContain('Contrase');

    expect(systems!.url).toBe('https://api.enphaseenergy.com/api/v4/systems?page=1&size=1');
    expect(systems!.init.headers).toEqual({
      Authorization: 'Bearer token-de-prueba',
      key: 'llave-app',
    });
  });

  it('reutiliza el token entre clientes de la misma cuenta', async () => {
    const { calls, fetchImpl } = fakeFetch((c) =>
      c.url.endsWith('/oauth/token') ? { body: TOKEN } : { body: { total: 1, systems: [] } },
    );
    await new EnphaseClient(creds, { fetchImpl }).testConnection();
    await new EnphaseClient(creds, { fetchImpl }).testConnection();
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('con 401 pide un token nuevo una vez', async () => {
    let first = true;
    const { calls, fetchImpl } = fakeFetch((c) => {
      if (c.url.endsWith('/oauth/token')) return { body: TOKEN };
      if (first) {
        first = false;
        return { status: 401, body: { message: 'Not Authorized' } };
      }
      return { body: { total: 1, systems: [] } };
    });
    await new EnphaseClient(creds, { fetchImpl }).testConnection();
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(2);
  });

  it('un error no repite las credenciales ni la respuesta del proveedor', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 401,
      body: { error: 'invalid_grant', error_description: creds.password },
    }));
    const err = await new EnphaseClient(creds, { fetchImpl }).testConnection().catch((e) => e);
    expect(err).toBeInstanceOf(EnphaseApiError);
    expect(String(err.message)).not.toContain(creds.password);
    expect(String(err.message)).not.toContain(creds.client_secret);
  });

  it('429 se marca como límite de uso', async () => {
    const { fetchImpl } = fakeFetch((c) =>
      c.url.endsWith('/oauth/token') ? { body: TOKEN } : { status: 429, body: {} },
    );
    const err = await new EnphaseClient(creds, { fetchImpl }).testConnection().catch((e) => e);
    expect(err).toBeInstanceOf(EnphaseApiError);
    expect(err.rateLimited).toBe(true);
  });
});

describe('fetchEnphaseProduction', () => {
  it('suma tres intervalos de 5 min por cuarto de hora y descarta el incompleto', async () => {
    // 8 intervalos desde 18:00: 18:00–18:15 y 18:15–18:30 completos; 18:30–18:40 incompleto.
    const { calls, fetchImpl } = fakeFetch((c) =>
      c.url.endsWith('/oauth/token') ? { body: TOKEN } : { body: micro(T0, 8) },
    );
    const until = new Date((T0 + 8 * 300) * 1000);
    const readings = await fetchEnphaseProduction(
      new EnphaseClient(creds, { fetchImpl }),
      698905955,
      new Date(T0 * 1000 + 7 * 60_000),
      until,
    );
    expect(readings).toEqual([
      { ts: new Date(T0 * 1000), powerKw: 0.6 }, // 150 Wh en 15 min = 0.6 kW
      { ts: new Date((T0 + 900) * 1000), powerKw: 0.6 },
    ]);
    const telemetry = calls.find((c) => c.url.includes('production_micro'));
    // Se pide desde el cuarto de hora, en segundos.
    expect(telemetry!.url).toBe(
      `https://api.enphaseenergy.com/api/v4/systems/698905955/telemetry/production_micro?start_at=${T0}&granularity=day`,
    );
  });

  it('recorre varios días y sigue aunque un día venga vacío', async () => {
    const day = 86_400;
    const { calls, fetchImpl } = fakeFetch((c) => {
      if (c.url.endsWith('/oauth/token')) return { body: TOKEN };
      const start = Number(new URL(c.url).searchParams.get('start_at'));
      if (start === T0) return { body: micro(T0, 288) };
      if (start === T0 + day) return { body: micro(T0 + day, 0) };
      return { body: micro(start, 3) };
    });
    const readings = await fetchEnphaseProduction(
      new EnphaseClient(creds, { fetchImpl }),
      1,
      new Date(T0 * 1000),
      new Date((T0 + 2 * day + 900) * 1000),
    );
    expect(calls.filter((c) => c.url.includes('production_micro'))).toHaveLength(3);
    expect(readings).toHaveLength(96 + 1);
    expect(readings.at(-1)!.ts).toEqual(new Date((T0 + 2 * day) * 1000));
  });
});

describe('enphaseAdapter', () => {
  it('se lee cada 2 horas y usa las llaves de la empresa', () => {
    expect(enphaseAdapter.pollEveryMinutes).toBe(120);
    expect(enphaseAdapter.usesCompanyIntegration).toBe(true);
    expect(enphaseAdapter.credentialsSchema!.parse({ system_id: '698905955' })).toEqual({
      system_id: 698905955,
    });
  });

  it('probar conexión sin las llaves de la empresa falla sin llamar a Enphase', async () => {
    expect(await enphaseAdapter.testConnection({ system_id: 1 }, undefined)).toEqual({
      ok: false,
      message: 'Falta conectar la cuenta de Enphase de la empresa',
    });
  });
});

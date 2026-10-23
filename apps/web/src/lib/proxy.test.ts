import { describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, proxyToApi } from './proxy';

describe('proxy /api → pv-api', () => {
  it('arma la URL interna con o sin esquema', () => {
    expect(apiBaseUrl({})).toBe('http://localhost:4000');
    expect(apiBaseUrl({ API_INTERNAL_URL: 'pv-api:10000' })).toBe('http://pv-api:10000');
    expect(apiBaseUrl({ API_INTERNAL_URL: 'https://api.example/' })).toBe('https://api.example');
  });

  it('reenvía método, query, cuerpo y solo las cabeceras permitidas (con la IP del cliente)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('{}', { status: 201 }));
    const req = new Request('https://app.example/api/tickets?open=true', {
      method: 'POST',
      body: '{"title":"x"}',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer t',
        cookie: 'pv_refresh=abc',
        'x-forwarded-for': '201.1.2.3',
        host: 'app.example',
        'x-secreto-interno': 'no',
      },
    });
    const res = await proxyToApi(req, ['tickets'], { API_INTERNAL_URL: 'pv-api:10000' }, fetchFn);
    expect(res.status).toBe(201);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://pv-api:10000/api/tickets?open=true');
    expect(init?.method).toBe('POST');
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"title":"x"}');
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(headers.get('cookie')).toBe('pv_refresh=abc');
    expect(headers.get('x-forwarded-for')).toBe('201.1.2.3');
    expect(headers.get('host')).toBeNull();
    expect(headers.get('x-secreto-interno')).toBeNull();
  });

  it('copia cada Set-Cookie y no las cabeceras de transporte', async () => {
    const upstream = new Headers({
      'content-type': 'application/json',
      'content-length': '2',
      connection: 'keep-alive',
    });
    upstream.append('set-cookie', 'a=1; Path=/api/auth; HttpOnly');
    upstream.append('set-cookie', 'b=2; Path=/');
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200, headers: upstream }),
    );
    const res = await proxyToApi(
      new Request('https://app.example/api/auth/refresh', { method: 'POST' }),
      ['auth', 'refresh'],
      {},
      fetchFn,
    );
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/api/auth; HttpOnly', 'b=2; Path=/']);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('connection')).toBeNull();
  });

  it('no sale de /api y responde 502 si la API no contesta', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    const dotdot = await proxyToApi(
      new Request('https://app.example/api/x'),
      ['..', 'health'],
      {},
      fetchFn,
    );
    expect(dotdot.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
    const down = await proxyToApi(new Request('https://app.example/api/me'), ['me'], {}, fetchFn);
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ error: { code: 'API_UNAVAILABLE' } });
  });
});

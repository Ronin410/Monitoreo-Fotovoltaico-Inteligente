import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient, noContent } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const item = z.object({ id: z.number() });

describe('cliente de la API', () => {
  it('manda el token, llama a /api del mismo origen y valida la respuesta', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json(200, { id: 1, extra: 'se descarta' }));
    const api = createApiClient({
      getToken: () => 'tok',
      refresh: async () => null,
      fetch: fetchFn,
    });
    expect(await api('/plants/1', item)).toEqual({ id: 1 });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/plants/1',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('ante un 401 renueva la sesión una vez y reintenta con el token nuevo', async () => {
    let token = 'viejo';
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { id: 2 }));
    const refresh = vi.fn(async () => (token = 'nuevo'));
    const api = createApiClient({ getToken: () => token, refresh, fetch: fetchFn });
    expect(await api('/x', item)).toEqual({ id: 2 });
    expect(refresh).toHaveBeenCalledTimes(1);
    const retry = fetchFn.mock.calls[1]![1] as RequestInit;
    expect((retry.headers as Record<string, string>).Authorization).toBe('Bearer nuevo');
  });

  it('sin sesión renovable (o con noRetry) devuelve el error de la API', async () => {
    const unauth = () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Inicia sesión para continuar' } });
    const refresh = vi.fn(async () => null);
    const api = createApiClient({
      getToken: () => null,
      refresh,
      fetch: vi.fn(async () => unauth()),
    });
    await expect(api('/x', item)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(
      api('/auth/login', item, { method: 'POST', noRetry: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('traduce errores de red, respuestas inválidas y 204', async () => {
    const down = createApiClient({
      getToken: () => null,
      refresh: async () => null,
      fetch: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(down('/x', item)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    const weird = createApiClient({
      getToken: () => null,
      refresh: async () => null,
      fetch: vi.fn(async () => json(200, { id: 'x' })),
    });
    await expect(weird('/x', item)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const html = createApiClient({
      getToken: () => null,
      refresh: async () => null,
      fetch: vi.fn(async () => new Response('<html>502</html>', { status: 502 })),
    });
    await expect(html('/x', item)).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });

    const empty = createApiClient({
      getToken: () => null,
      refresh: async () => null,
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
    });
    await expect(empty('/auth/logout', noContent, { method: 'POST' })).resolves.toBeUndefined();
  });

  it('envía el cuerpo como JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json(200, { id: 3 }));
    const api = createApiClient({
      getToken: () => null,
      refresh: async () => null,
      fetch: fetchFn,
    });
    await api('/tickets', item, { method: 'POST', body: { title: 'Lavado' } });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"Lavado"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('envía un archivo tal cual, con su tipo (logo)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json(201, { id: 1 }));
    const api = createApiClient({ getToken: () => 't', refresh: async () => null, fetch: fetchFn });
    const file = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    await api('/company/logo', item, { method: 'POST', body: file });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(file);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/svg+xml');
  });
});

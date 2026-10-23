import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuthProvider, useAuth } from './auth';

const USER = {
  id: '0b9f6f2e-7a43-4c39-9b8e-0f6a1c2d3e4f',
  email: 'op@ej.com',
  name: 'Omar',
  role: 'operator',
};
const COMPANY = {
  id: '1b9f6f2e-7a43-4c39-9b8e-0f6a1c2d3e4f',
  name: 'Solar Demo',
  slug: 'solar-demo',
  logo_url: null,
  brand_color: '#0E7490',
  timezone: 'America/Mazatlan',
};
const session = (token: string) => ({
  access_token: token,
  token_type: 'Bearer',
  expires_in: 900,
  user: { ...USER, company_id: COMPANY.id },
});
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

/** API falsa: cookie de refresh válida o no, y tokens que caducan. */
function fakeApi(opts: { hasCookie: boolean }) {
  let cookie = opts.hasCookie;
  let valid = 'tok-1';
  let n = 1;
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/auth/refresh') {
      if (!cookie)
        return json(401, { error: { code: 'INVALID_SESSION', message: 'La sesión no es válida' } });
      valid = `tok-${++n}`;
      return json(200, session(valid));
    }
    if (url === '/api/auth/login') {
      const body = JSON.parse(String(init?.body)) as { password: string };
      if (body.password !== 'correcta-123') {
        return json(401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' },
        });
      }
      cookie = true;
      valid = `tok-${++n}`;
      return json(200, session(valid));
    }
    if (url === '/api/auth/logout') {
      cookie = false;
      return json(204);
    }
    if (auth !== `Bearer ${valid}`)
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    if (url === '/api/me') return json(200, { user: USER, company: COMPANY });
    return json(200, { ok: true });
  });
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    calls,
    expire: () => (valid = 'otro'),
    dropCookie: () => (cookie = false),
  };
}

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  ctx = useAuth();
  const s = ctx.state;
  return <p>{s.status === 'authenticated' ? `${s.user.name} · ${s.company?.name}` : s.status}</p>;
}

afterEach(() => vi.restoreAllMocks());

describe('sesión en el navegador', () => {
  it('sin cookie de refresh queda anónima', async () => {
    const api = fakeApi({ hasCookie: false });
    render(
      <AuthProvider fetchImpl={api.fetchFn}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('anonymous')).toBeTruthy();
  });

  it('con cookie de refresh recupera la sesión al cargar', async () => {
    const api = fakeApi({ hasCookie: true });
    render(
      <AuthProvider fetchImpl={api.fetchFn}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('Omar · Solar Demo')).toBeTruthy();
  });

  it('login con error lo propaga; login correcto carga /me; logout la cierra', async () => {
    const api = fakeApi({ hasCookie: false });
    render(
      <AuthProvider fetchImpl={api.fetchFn}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('anonymous');
    await expect(act(() => ctx.login('op@ej.com', 'mala'))).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Correo o contraseña incorrectos',
    });
    await act(() => ctx.login('op@ej.com', 'correcta-123'));
    expect(screen.getByText('Omar · Solar Demo')).toBeTruthy();
    await act(() => ctx.logout());
    expect(screen.getByText('anonymous')).toBeTruthy();
  });

  it('un token vencido se renueva una sola vez aunque fallen varias peticiones a la vez', async () => {
    const api = fakeApi({ hasCookie: true });
    render(
      <AuthProvider fetchImpl={api.fetchFn}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('Omar · Solar Demo');
    api.expire();
    const before = api.calls.filter((c) => c.endsWith('/auth/refresh')).length;
    const results = await act(() =>
      Promise.all([
        ctx.api('/plants', z.object({ ok: z.literal(true) })),
        ctx.api('/alerts', z.object({ ok: z.literal(true) })),
      ]),
    );
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(api.calls.filter((c) => c.endsWith('/auth/refresh')).length - before).toBe(1);
  });

  it('si la renovación falla en plena sesión, la petición falla y pasa a anónima', async () => {
    const api = fakeApi({ hasCookie: true });
    render(
      <AuthProvider fetchImpl={api.fetchFn}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('Omar · Solar Demo');
    api.expire();
    api.dropCookie();
    // El error se captura dentro de act: si act se rechaza, React no aplica el cambio de estado.
    let caught: unknown;
    await act(async () => {
      await ctx.api('/plants', z.object({ ok: z.literal(true) })).catch((e: unknown) => {
        caught = e;
      });
    });
    expect(caught).toMatchObject({ status: 401 });
    await waitFor(() => expect(screen.getByText('anonymous')).toBeTruthy());
  });
});

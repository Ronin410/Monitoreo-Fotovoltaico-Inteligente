'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createApiClient, noContent, type ApiClient } from './api';
import { meResponse, sessionResponse, type Me, type SessionResponse } from './schemas';

// Sesión del lado del navegador (specs/02): el access token vive solo en memoria; la cookie
// httpOnly de refresh (path /api/auth) lo renueva al cargar la página y ante un 401.

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: Me['user']; company: Me['company'] };

export type AuthContextValue = {
  state: AuthState;
  api: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Guarda una sesión recién obtenida (aceptar invitación) y carga el usuario. */
  startSession: (session: SessionResponse) => Promise<void>;
  /** Vuelve a leer /me (por ejemplo tras cambiar la marca). */
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  fetchImpl,
}: {
  children: ReactNode;
  /** Solo para pruebas. */
  fetchImpl?: typeof fetch;
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const token = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);

  // Una sola renovación a la vez: varias peticiones con 401 comparten la misma.
  const refresh = useCallback(() => {
    refreshing.current ??= (async () => {
      try {
        const raw = createApiClient({
          getToken: () => null,
          refresh: async () => null,
          fetch: fetchImpl,
        });
        const session = await raw('/auth/refresh', sessionResponse, {
          method: 'POST',
          noRetry: true,
        });
        token.current = session.access_token;
        return session.access_token;
      } catch {
        token.current = null;
        setState({ status: 'anonymous' });
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [fetchImpl]);

  const api = useMemo(
    () => createApiClient({ getToken: () => token.current, refresh, fetch: fetchImpl }),
    [refresh, fetchImpl],
  );

  const loadMe = useCallback(async () => {
    const me = await api('/me', meResponse);
    setState({ status: 'authenticated', user: me.user, company: me.company });
  }, [api]);

  const startSession = useCallback(
    async (session: SessionResponse) => {
      token.current = session.access_token;
      await loadMe();
    },
    [loadMe],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api('/auth/login', sessionResponse, {
        method: 'POST',
        body: { email, password },
        noRetry: true,
      });
      await startSession(session);
    },
    [api, startSession],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', noContent, { method: 'POST', noRetry: true });
    } finally {
      token.current = null;
      setState({ status: 'anonymous' });
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await refresh();
      if (cancelled || !t) return;
      try {
        await loadMe();
      } catch {
        if (!cancelled) setState({ status: 'anonymous' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, api, login, logout, startSession, reload: loadMe }),
    [state, api, login, logout, startSession, loadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

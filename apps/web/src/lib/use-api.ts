'use client';

import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { ApiError } from './api';
import { useAuth } from './auth';
import { errorMessage } from './errors';

/** Carga `path` (y lo recarga cuando cambia). `path = null` no carga nada. */
export function useApiQuery<S extends z.ZodType>(path: string | null, schema: S) {
  const { api } = useAuth();
  const [data, setData] = useState<z.output<S> | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const load = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api(path, schema));
    } catch (err) {
      setError({ message: errorMessage(err), status: err instanceof ApiError ? err.status : 0 });
    } finally {
      setLoading(false);
    }
  }, [api, path, schema]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

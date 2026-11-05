'use client';

import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { useAuth } from '@/lib/auth';
import {
  alertsResponse,
  mapResponse,
  summaryResponse,
  topBottomResponse,
  upcomingCleaningsResponse,
} from '@/lib/dashboard';
import { errorMessage } from '@/lib/errors';

export type DashboardData = {
  summary: z.infer<typeof summaryResponse>;
  map: z.infer<typeof mapResponse>;
  cleanings: z.infer<typeof upcomingCleaningsResponse>;
  ranking: z.infer<typeof topBottomResponse>;
  attention: z.infer<typeof alertsResponse>;
};

/** `segment`: tipo de instalación para filtrar el tablero (vacío = todas). */
export function useDashboard(segment = '') {
  const { api } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const seg = segment ? `installation_type=${segment}` : '';
      const q = (base: string) => (seg ? `${base}${base.includes('?') ? '&' : '?'}${seg}` : base);
      const [summary, map, cleanings, ranking, attention] = await Promise.all([
        api(q('/dashboard/summary'), summaryResponse),
        api(q('/dashboard/map'), mapResponse),
        api(q('/dashboard/upcoming-cleanings?days=14'), upcomingCleaningsResponse),
        api(q('/dashboard/top-bottom?days=30'), topBottomResponse),
        // Negocios y plantas grandes primero (specs/06 §5).
        api(q('/alerts?open=true&page_size=50&sort=priority'), alertsResponse),
      ]);
      setData({ summary, map, cleanings, ranking, attention });
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, segment]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

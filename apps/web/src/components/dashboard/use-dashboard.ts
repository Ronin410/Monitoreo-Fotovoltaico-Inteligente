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

export function useDashboard() {
  const { api } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [summary, map, cleanings, ranking, attention] = await Promise.all([
        api('/dashboard/summary', summaryResponse),
        api('/dashboard/map', mapResponse),
        api('/dashboard/upcoming-cleanings?days=14', upcomingCleaningsResponse),
        api('/dashboard/top-bottom?days=30', topBottomResponse),
        api('/alerts?open=true&page_size=50', alertsResponse),
      ]);
      setData({ summary, map, cleanings, ranking, attention });
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

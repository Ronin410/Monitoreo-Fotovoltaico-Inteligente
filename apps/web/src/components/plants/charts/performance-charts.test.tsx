import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceCharts } from './performance-charts';

const day = (date: string, over: object = {}) => ({
  date,
  energy_kwh: 20,
  pr_temp: 0.8,
  pr_baseline: 0.9,
  deviation_pct: 11,
  neighbor_index: 0.92,
  neighbor_count: 4,
  rain_mm: 0,
  is_valid_day: true,
  invalid_reason: null,
  days_to_cleaning: null,
  soiling_slope_pct_per_day: null,
  status: 'ok',
  ...over,
});
const metrics = {
  from: '2026-10-20',
  to: '2026-10-22',
  soiling_deviation_pct: 12,
  days: [
    day('2026-10-20', { rain_mm: 5, is_valid_day: false }),
    day('2026-10-21'),
    day('2026-10-22', { days_to_cleaning: 3, soiling_slope_pct_per_day: -0.6 }),
  ],
  events: [{ type: 'rain_cleaning', date: '2026-10-20', source: 'auto' }],
};
const api = vi.fn(async (_path: string, schema: { parse: (v: unknown) => unknown }) =>
  schema.parse(metrics),
);
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ api }) }));

describe('gráficas de rendimiento', () => {
  it('pide el periodo en la zona de la empresa y muestra predicción, tabla y vecinas', async () => {
    render(
      <PerformanceCharts
        plantId="00000000-0000-4000-8000-000000000001"
        timezone="America/Mazatlan"
      />,
    );
    expect(await screen.findByText('Rendimiento diario (PR corregido)')).toBeTruthy();
    expect(api.mock.calls[0]![0]).toMatch(
      /daily-metrics\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    // Predicción: último día con tendencia.
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('-0.60 % por día')).toBeTruthy();
    expect(screen.getByText('Lavado por lluvia, 20 oct')).toBeTruthy();
    // Tabla accesible con los días, incluido el no válido.
    const cells = Array.from(document.querySelectorAll('details tbody tr')).map(
      (r) => r.textContent,
    );
    expect(cells.some((t) => t?.includes('5.0 mm') && t.includes('No'))).toBe(true);
    expect(screen.getByText('Comparación con vecinas')).toBeTruthy();
  });
});

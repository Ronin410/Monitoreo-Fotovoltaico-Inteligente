import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { DashboardView } from './dashboard-view';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// El mapa usa Leaflet (window real); aquí basta con saber cuántas plantas recibe.
vi.mock('next/dynamic', () => ({
  default: () => (props: { plants: unknown[] }) => (
    <div data-testid="mapa">{props.plants.length} plantas</div>
  ),
}));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixtures: Record<string, unknown> = {
  '/dashboard/summary': {
    date: '2026-10-23',
    timezone: 'America/Mazatlan',
    plants: { active: 25, capacity_kwp: 553, clients: 20 },
    energy_today_kwh: 24.8,
    energy_month_kwh: 50_300,
    pr_temp_7d: 0.857,
    alerts_open: { critical: 1, warning: 3, info: 1 },
    offline_plants: 1,
  },
  '/dashboard/map': {
    plants: [
      {
        id: ID(1),
        name: 'A',
        client_name: 'C',
        colonia: 'Centro',
        capacity_kwp: 5,
        lat: 24.8,
        lon: -107.4,
        status: 'ok',
        last_power_kw: 1,
        last_reading_at: null,
      },
      {
        id: ID(2),
        name: 'B',
        client_name: 'C',
        colonia: 'Centro',
        capacity_kwp: 5,
        lat: 24.8,
        lon: -107.4,
        status: 'warning',
        last_power_kw: null,
        last_reading_at: null,
      },
    ],
  },
  '/dashboard/upcoming-cleanings?days=14': {
    days: 14,
    plants: [
      {
        id: ID(3),
        name: 'Comercial Centro 19',
        client_name: 'Escuela',
        days_to_cleaning: 0,
        confidence: 'high',
        deviation_pct: 15.5,
        soiling_slope_pct_per_day: -0.8,
        date: '2026-10-22',
      },
      {
        id: ID(4),
        name: 'Residencial 18',
        client_name: 'Bodega',
        days_to_cleaning: 1,
        confidence: 'medium',
        deviation_pct: 10.3,
        soiling_slope_pct_per_day: -0.7,
        date: '2026-10-22',
      },
    ],
  },
  '/dashboard/top-bottom?days=30': {
    days: 30,
    min_valid_days: 5,
    best: [{ id: ID(5), name: 'La mejor', client_name: 'C', pr_temp_avg: 0.9, valid_days: 28 }],
    worst: [],
  },
  '/alerts?open=true&page_size=50': {
    data: [
      {
        id: ID(6),
        type: 'offline',
        severity: 'critical',
        status: 'open',
        detected_at: '2026-10-23T14:18:00Z',
        plant: {
          id: ID(7),
          name: 'Residencial Centro 22',
          colonia: 'Centro',
          client_name: 'Carlos',
        },
      },
      {
        id: ID(8),
        type: 'cleaning_due_soon',
        severity: 'info',
        status: 'open',
        detected_at: '2026-10-22T05:00:00Z',
        plant: { id: ID(4), name: 'Residencial 18', colonia: 'Centro', client_name: 'Bodega' },
      },
    ],
    total: 2,
  },
};

let failOnce = false;
const api = vi.fn(async (path: string, schema: { parse: (v: unknown) => unknown }) => {
  if (failOnce) {
    failOnce = false;
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor.');
  }
  return schema.parse(fixtures[path]);
});
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ api }) }));

beforeEach(() => {
  api.mockClear();
  push.mockClear();
});

describe('tablero', () => {
  it('muestra tarjetas, mapa, alertas que requieren atención, lavados y ranking', async () => {
    render(<DashboardView />);
    expect(await screen.findByText('viernes, 23 de octubre')).toBeTruthy();
    const resumen = screen.getByRole('region', { name: 'Resumen' }).textContent ?? '';
    expect(resumen).toContain('553.0 kWp · 20 clientes');
    expect(resumen).toMatch(/24\.8\s*kWh/);
    expect(resumen).toMatch(/50\.3\s*MWh/);
    expect(resumen).toMatch(/85\.7\s*%/);
    expect(resumen).toContain('1 crítica');
    expect(resumen).toContain('3 advertencias');
    expect(resumen).toContain('1 aviso');
    expect(screen.getByTestId('mapa').textContent).toBe('2 plantas');
    // Los avisos (info) no entran en "Requieren atención".
    expect(screen.getByRole('link', { name: /Residencial Centro 22/ }).getAttribute('href')).toBe(
      `/alerts/${ID(6)}`,
    );
    expect(screen.queryByRole('link', { name: /Lavado próximo/ })).toBeNull();
    expect(screen.getByText('Ya')).toBeTruthy();
    expect(screen.getByText('día')).toBeTruthy();
    expect(screen.getByText('La mejor')).toBeTruthy();
    expect(screen.getByText('Sin suficientes días válidos.')).toBeTruthy();
  });

  it('la pregunta rápida abre el asistente con la pregunta', async () => {
    render(<DashboardView />);
    await screen.findByText('viernes, 23 de octubre');
    await userEvent.type(screen.getByLabelText('Pregúntale a tu flota'), '¿qué plantas lavo?');
    await userEvent.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(push).toHaveBeenCalledWith('/assistant?q=%C2%BFqu%C3%A9%20plantas%20lavo%3F');
  });

  it('si falla muestra el error y permite reintentar', async () => {
    failOnce = true;
    render(<DashboardView />);
    expect(await screen.findByText(/No se pudo cargar el tablero/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('viernes, 23 de octubre')).toBeTruthy();
  });

  it('sin plantas invita a dar de alta la primera', async () => {
    const original = fixtures['/dashboard/summary'];
    fixtures['/dashboard/summary'] = {
      ...(original as object),
      plants: { active: 0, capacity_kwp: 0, clients: 0 },
    };
    render(<DashboardView />);
    expect(
      (await screen.findByRole('link', { name: 'Da de alta tu primera planta' })).getAttribute(
        'href',
      ),
    ).toBe('/plants');
    fixtures['/dashboard/summary'] = original;
  });
});

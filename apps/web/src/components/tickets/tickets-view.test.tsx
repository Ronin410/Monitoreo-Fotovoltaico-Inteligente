import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '@/lib/operations';
import { TicketsView } from './tickets-view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: ID(1),
  type: 'cleaning',
  status: 'scheduled',
  priority: 'high',
  title: 'Lavado de paneles — Comercial Centro',
  description: 'Posible suciedad. Rinde 15.2 % por debajo de su normal.',
  scheduled_for: '2026-10-24',
  resolved_at: null,
  resolution_notes: null,
  cleaning_performed: false,
  assigned_to: { id: ID(9), name: 'Técnico Uno' },
  created_by: { id: ID(8), name: 'Operadora' },
  plant: {
    id: ID(2),
    name: 'Comercial Centro',
    capacity_kwp: 10,
    colonia: 'Centro',
    postal_code: '80000',
    lat: 24.8069,
    lon: -107.3938,
    client: {
      id: ID(3),
      name: 'Abarrotes El Sol',
      contact_name: 'Rosa',
      phone: '667 123 4567',
      address: 'Av. Obregón 100',
    },
  },
  alert: null,
  created_at: '2026-10-22T18:00:00Z',
  updated_at: '2026-10-22T18:00:00Z',
  ...over,
});

let role = 'technician';
let tickets: Ticket[] = [];
const calls: { path: string; method?: string; body?: unknown }[] = [];
const api = vi.fn(
  async (
    path: string,
    schema: { parse: (v: unknown) => unknown },
    opts?: { method?: string; body?: unknown },
  ) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    if (path === '/tickets/assignees')
      return schema.parse({ data: [{ id: ID(9), name: 'Técnico Uno', role: 'technician' }] });
    if (opts?.method === 'PATCH') {
      const updated = { ...tickets[0], ...(opts.body as object) } as Ticket;
      tickets = [updated];
      return schema.parse(updated);
    }
    const open = path.includes('open=true');
    const data = tickets.filter((t) =>
      ['pending', 'scheduled', 'in_progress'].includes(t.status) ? open : !open,
    );
    return schema.parse({ data, page: 1, page_size: 25, total: data.length });
  },
);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api,
    state: { status: 'authenticated', user: { role }, company: { timezone: 'America/Mazatlan' } },
  }),
}));

beforeEach(() => {
  calls.length = 0;
  tickets = [ticket()];
});

describe('vista del técnico (celular)', () => {
  beforeEach(() => {
    role = 'technician';
  });

  it('tarjeta con dirección a Google Maps, teléfono y qué revisar; sin cancelar', async () => {
    render(<TicketsView />);
    const card = (await screen.findByText('Lavado de paneles — Comercial Centro')).closest('li');
    if (!card) throw new Error('sin tarjeta');
    const c = within(card);
    expect(c.getByRole('link', { name: /Av. Obregón 100, Centro/ }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=24.8069%2C-107.3938',
    );
    expect(c.getByRole('link', { name: /667 123 4567/ }).getAttribute('href')).toBe(
      'tel:6671234567',
    );
    expect(c.getByText('Qué revisar')).toBeTruthy();
    expect(c.getByText(/Rinde 15.2 %/)).toBeTruthy();
    expect(c.getByText('Prioridad alta')).toBeTruthy();
    expect(c.queryByRole('button', { name: 'Cancelar ticket' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Nuevo ticket/ })).toBeNull();
    // Solo pide sus tickets abiertos (la API limita al técnico a los suyos).
    expect(calls[0]?.path).toBe('/tickets?open=true&page=1&page_size=25');
  });

  it('iniciar y resolver con notas y "Se realizó limpieza"', async () => {
    render(<TicketsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({
      path: `/tickets/${ID(1)}`,
      method: 'PATCH',
      body: { status: 'in_progress' },
    });
    expect(await screen.findByText(/Lavado · En curso/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    const cleaning = screen.getByRole('checkbox', { name: 'Se realizó limpieza' });
    // Un ticket de lavado la trae marcada; se puede desmarcar y volver a marcar.
    expect((cleaning as HTMLInputElement).checked).toBe(true);
    await userEvent.type(
      screen.getByLabelText('Notas de lo que se hizo'),
      'Lavado con agua desmineralizada',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resuelto' }));
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({
      status: 'resolved',
      resolution_notes: 'Lavado con agua desmineralizada',
      cleaning_performed: true,
    });
    // Resuelto: deja la lista de pendientes.
    expect(await screen.findByText('No tienes tickets pendientes.')).toBeTruthy();
  });
});

describe('vista del operador', () => {
  beforeEach(() => {
    role = 'operator';
  });

  it('lista con nuevo ticket y tablero de abiertos por estado', async () => {
    tickets = [
      ticket(),
      ticket({ id: ID(4), status: 'pending', title: 'Revisar inversor', assigned_to: null }),
    ];
    render(<TicketsView />);
    expect(await screen.findByRole('link', { name: /Nuevo ticket/ })).toBeTruthy();
    expect(screen.getAllByText('Revisar inversor').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Tablero' }));
    const pending = await screen.findByRole('region', { name: /Pendiente/ });
    expect(within(pending).getByText('Revisar inversor')).toBeTruthy();
    const scheduled = screen.getByRole('region', { name: /Programado/ });
    expect(within(scheduled).getByText('Lavado de paneles — Comercial Centro')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: /En curso/ })).getByText('Ninguno.'),
    ).toBeTruthy();
    expect(calls.at(-1)?.path).toBe('/tickets?open=true&page_size=100');
  });
});

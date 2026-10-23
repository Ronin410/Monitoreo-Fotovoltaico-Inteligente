import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompaniesView } from './companies-view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = (over: object = {}) => ({
  id: ID(1),
  name: 'Solar Demo Culiacán',
  slug: 'solar-demo-culiacan',
  status: 'active',
  plan: 'piloto',
  timezone: 'America/Mazatlan',
  brand_color: '#F59E0B',
  ai_monthly_token_budget: 2_000_000,
  created_at: '2026-09-01T00:00:00Z',
  plant_count: 25,
  ai_tokens_this_month: 1_700_000,
  ...over,
});
const calls: { path: string; method?: string; body?: unknown }[] = [];
const api = vi.fn(
  async (
    path: string,
    schema: { parse: (v: unknown) => unknown },
    opts?: { method?: string; body?: unknown },
  ) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    if (opts?.method === 'POST')
      return schema.parse({
        company: company({ id: ID(2), name: 'Nueva' }),
        invitation: { id: ID(3), email: 'admin@nueva.mx', expires_at: '2026-10-30T00:00:00Z' },
      });
    if (opts?.method === 'PATCH') return schema.parse(company(opts.body as object));
    return schema.parse({ data: [company()], page: 1, page_size: 25, total: 1 });
  },
);
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ api }) }));

beforeEach(() => {
  calls.length = 0;
});

describe('empresas (superadmin)', () => {
  it('muestra plantas y uso de IA; suspende con confirmación', async () => {
    render(<CompaniesView />);
    expect(await screen.findByText('Solar Demo Culiacán')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getByText('1.7 millones / 2 millones')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, suspender' }));
    expect(calls.at(-1)).toEqual({
      path: `/admin/companies/${ID(1)}`,
      method: 'PATCH',
      body: { status: 'suspended' },
    });
    expect(await screen.findByText('Suspendida')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeTruthy();
  });

  it('crea la empresa con la invitación de su primer administrador', async () => {
    render(<CompaniesView />);
    await userEvent.click(await screen.findByRole('button', { name: /Nueva empresa/ }));
    await userEvent.type(screen.getByLabelText(/^Nombre/), 'Nueva');
    await userEvent.type(
      screen.getByLabelText(/Correo del primer administrador/),
      'admin@nueva.mx',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Crear e invitar' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Nueva',
      timezone: 'America/Mazatlan',
      ai_monthly_token_budget: 2_000_000,
      admin_email: 'admin@nueva.mx',
    });
    expect(await screen.findByText(/Se envió la invitación a admin@nueva.mx/)).toBeTruthy();
  });
});

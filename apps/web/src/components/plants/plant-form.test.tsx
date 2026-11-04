import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlantForm } from './plant-form';

// Casillas "Tiene batería" y "Tiene límite de inyección" (specs/06 §2.4).

const CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const calls: { path: string; method?: string; body?: unknown }[] = [];
const api = vi.fn(
  async (path: string, _schema: unknown, opts?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    if (path.startsWith('/clients'))
      return { data: [{ id: CLIENT_ID, name: 'Cliente Uno' }], page: 1, page_size: 100, total: 1 };
    if (path === '/company')
      return {
        settings: {
          defaults: { noct_c: 45, gamma_pct_per_c: -0.4, tilt_deg: 20, azimuth_deg: 180 },
        },
      };
    return { id: '00000000-0000-4000-8000-000000000002' };
  },
);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ api, state: { status: 'authenticated', features: { simulator: false } } }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('formulario de planta', () => {
  it('manda si la planta tiene batería o límite de inyección', async () => {
    render(<PlantForm />);
    await userEvent.type(await screen.findByLabelText(/Nombre/), 'Casa con batería');
    await userEvent.type(screen.getByLabelText(/Capacidad/), '5');
    await userEvent.click(screen.getByLabelText(/Tiene batería/));
    expect(screen.getByText(/no genera alertas de suciedad/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Guardar|Crear/ }));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({ has_battery: true, export_limited: false });
  });
});

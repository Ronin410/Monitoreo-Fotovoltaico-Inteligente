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
  last_export_at: null,
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
    if (path.endsWith('/example-data') || path.endsWith('/purge'))
      return schema.parse({ queued: true });
    if (path.endsWith('/invitations'))
      return schema.parse({
        id: ID(4),
        email: (opts?.body as { email: string }).email,
        expires_at: '2026-10-30T00:00:00Z',
        email_sent: emailSent,
      });
    if (opts?.method === 'POST')
      return schema.parse({
        company: company({ id: ID(2), name: 'Nueva' }),
        invitation: { id: ID(3), email: 'admin@nueva.mx', expires_at: '2026-10-30T00:00:00Z' },
        email_sent: emailSent,
      });
    if (opts?.method === 'PATCH') return schema.parse(company(opts.body as object));
    return schema.parse({
      data: [company({ plant_count: plantCount })],
      page: 1,
      page_size: 25,
      total: 1,
    });
  },
);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ api, state: { status: 'authenticated', features: { simulator: true } } }),
}));
/** Plantas de la empresa listada (0 = vacía, se ofrecen datos de ejemplo). */
let plantCount = 25;

beforeEach(() => {
  calls.length = 0;
});

/** El servidor pudo enviar el correo de invitación. */
let emailSent = true;

describe('empresas (superadmin)', () => {
  it('borra definitivamente una empresa suspendida, confirmando con su identificador', async () => {
    render(<CompaniesView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, suspender' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar definitivamente' }));
    expect(screen.getByText(/nunca exportó sus datos/)).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText(/Escriba el identificador "solar-demo-culiacan"/),
      'solar-demo-culiacan',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Borrar definitivamente' }));
    expect(calls.at(-1)).toEqual({
      path: `/admin/companies/${ID(1)}/purge`,
      method: 'POST',
      body: { confirm_slug: 'solar-demo-culiacan' },
    });
    expect(await screen.findByText(/Borrando la empresa y todos sus datos/)).toBeTruthy();
  });

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

  it('si el correo no sale, la empresa queda creada y lo dice', async () => {
    emailSent = false;
    try {
      render(<CompaniesView />);
      await userEvent.click(await screen.findByRole('button', { name: /Nueva empresa/ }));
      await userEvent.type(screen.getByLabelText(/^Nombre/), 'Nueva');
      await userEvent.type(
        screen.getByLabelText(/Correo del primer administrador/),
        'admin@nueva.mx',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Crear e invitar' }));
      const notice = await screen.findByText(/no se pudo enviar la invitación a admin@nueva.mx/);
      expect(notice.closest('[role="alert"]')).toBeTruthy();
    } finally {
      emailSent = true;
    }
  });

  it('reenvía la invitación del primer administrador', async () => {
    render(<CompaniesView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reenviar invitación' }));
    await userEvent.type(screen.getByLabelText(/Correo del administrador/), 'admin@laempresa.mx');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));
    expect(calls.at(-1)).toEqual({
      path: `/admin/companies/${ID(1)}/invitations`,
      method: 'POST',
      body: { email: 'admin@laempresa.mx' },
    });
    expect(await screen.findByText('Invitación enviada a admin@laempresa.mx.')).toBeTruthy();
  });

  it('ofrece datos de ejemplo solo a una empresa vacía, con confirmación', async () => {
    const { unmount } = render(<CompaniesView />);
    await screen.findByText('Solar Demo Culiacán');
    expect(screen.queryByRole('button', { name: 'Cargar datos de ejemplo' })).toBeNull();
    unmount();

    plantCount = 0;
    try {
      render(<CompaniesView />);
      await userEvent.click(await screen.findByRole('button', { name: 'Cargar datos de ejemplo' }));
      expect(calls.some((c) => c.path.endsWith('/example-data'))).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Sí, cargar' }));
      expect(calls.at(-1)).toEqual({
        path: `/admin/companies/${ID(1)}/example-data`,
        method: 'POST',
        body: undefined,
      });
      expect(await screen.findByText(/Cargando datos de ejemplo/)).toBeTruthy();
    } finally {
      plantCount = 25;
    }
  });
});

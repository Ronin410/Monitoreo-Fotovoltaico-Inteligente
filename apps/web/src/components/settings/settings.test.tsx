import { DEFAULT_SETTINGS } from '@pv/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { Company } from '@/lib/settings';
import { NotificationsSection, NumbersSection } from './settings-section';
import { UsersPanel } from './users-panel';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calls: { path: string; method?: string; body?: unknown }[] = [];
let reply: (path: string, body: unknown) => unknown;
const api = vi.fn(
  async (
    path: string,
    schema: { parse: (v: unknown) => unknown },
    opts?: { method?: string; body?: unknown },
  ) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    return schema.parse(reply(path, opts?.body));
  },
);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api,
    reload: async () => {},
    state: { status: 'authenticated', user: { id: ID(1), role: 'company_admin' } },
  }),
}));

const company = (over: Partial<Company['settings']['thresholds']> = {}): Company => ({
  id: ID(9),
  name: 'Solar Demo',
  slug: 'solar-demo',
  logo_url: null,
  brand_color: '#0E7490',
  timezone: 'America/Mazatlan',
  plan: 'piloto',
  ai_monthly_token_budget: 2_000_000,
  settings: {
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...over },
    defaults: { ...DEFAULT_SETTINGS.defaults },
    notifications: { alert_emails: [], auto_send_client_reports: false },
  },
});

beforeEach(() => {
  calls.length = 0;
});

describe('umbrales', () => {
  it('guarda solo lo que cambió y marca lo personalizado', async () => {
    reply = (_p, body) => {
      const t = (body as { settings: { thresholds: object } }).settings.thresholds;
      return {
        ...company(),
        settings: { ...company().settings, thresholds: { ...company().settings.thresholds, ...t } },
      };
    };
    const onSaved = vi.fn();
    render(<NumbersSection section="thresholds" company={company()} onSaved={onSaved} />);
    expect(screen.getByText(/Todos están en su valor por omisión/)).toBeTruthy();
    const offline = screen.getByLabelText('Horas de sol sin datos (h)');
    await userEvent.clear(offline);
    await userEvent.type(offline, '6');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(calls[0]).toEqual({
      path: '/company',
      method: 'PATCH',
      body: { settings: { thresholds: { offline_hours: 6 } } },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Cambios guardados.')).toBeTruthy();
  });

  it('texto que no es número se marca sin llamar a la API; el error de la API va a su campo', async () => {
    render(<NumbersSection section="thresholds" company={company()} onSaved={() => {}} />);
    const field = screen.getByLabelText('Radio de vecinas (km)');
    await userEvent.clear(field);
    await userEvent.type(field, 'cinco');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText('Escribe un número (usa punto para decimales).')).toBeTruthy();

    reply = () => {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Datos inválidos', [
        { path: 'settings.thresholds.neighbor_radius_km', message: 'Debe ser ≤ 50' },
      ]);
    };
    await userEvent.clear(field);
    await userEvent.type(field, '80');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Debe ser ≤ 50')).toBeTruthy();
  });

  it('restablecer manda la sección en null', async () => {
    reply = () => company();
    render(
      <NumbersSection
        section="thresholds"
        company={company({ offline_hours: 6 })}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText(/1 valor personalizado/)).toBeTruthy();
    expect(screen.getByText(/Por omisión: 4 \(personalizado\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, restablecer' }));
    expect(calls[0]?.body).toEqual({ settings: { thresholds: null } });
  });
});

describe('notificaciones', () => {
  it('correos uno por línea (sin repetir, en minúsculas) y envío automático', async () => {
    reply = () => company();
    render(<NotificationsSection company={company()} onSaved={() => {}} />);
    await userEvent.type(
      screen.getByLabelText('Correos que reciben las alertas'),
      'Ops@Solar.mx{enter}ops@solar.mx, guardia@solar.mx',
    );
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(calls[0]?.body).toEqual({
      settings: {
        notifications: {
          alert_emails: ['ops@solar.mx', 'guardia@solar.mx'],
          auto_send_client_reports: true,
        },
      },
    });
  });
});

describe('usuarios', () => {
  const user = (n: number, over: object = {}) => ({
    id: ID(n),
    email: `u${n}@solar.mx`,
    name: `Usuario ${n}`,
    role: 'operator',
    status: 'active',
    last_login_at: null,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  });

  it('invita, cambia el rol y desactiva; a uno mismo no se le ofrecen controles', async () => {
    reply = (path, body) => {
      if (path.startsWith('/company/users?'))
        return {
          data: [user(1, { role: 'company_admin', name: 'Yo' }), user(2)],
          page: 1,
          page_size: 25,
          total: 2,
        };
      if (path === '/company/invitations' && body === undefined) return { data: [] };
      if (path === '/company/invitations')
        return {
          id: ID(7),
          email: 'nuevo@solar.mx',
          role: 'technician',
          expires_at: '2026-10-30T00:00:00Z',
        };
      return user(2, body as object);
    };
    render(<UsersPanel timezone="America/Mazatlan" />);
    expect(await screen.findByText('(tú)')).toBeTruthy();
    expect(screen.queryByLabelText('Rol de Yo')).toBeNull();

    await userEvent.type(screen.getByLabelText(/^Correo/), 'nuevo@solar.mx');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), 'technician');
    await userEvent.click(screen.getByRole('button', { name: /Invitar/ }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'nuevo@solar.mx',
      role: 'technician',
    });
    expect(await screen.findByText(/Invitación enviada a nuevo@solar.mx/)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Rol de Usuario 2'), 'technician');
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toEqual({
      path: `/company/users/${ID(2)}`,
      method: 'PATCH',
      body: { role: 'technician' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, desactivar' }));
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ status: 'disabled' });
    expect(await screen.findByRole('button', { name: 'Reactivar' })).toBeTruthy();
  });

  it('muestra el error de la API (último administrador)', async () => {
    reply = (path, body) => {
      if (path.startsWith('/company/users?'))
        return { data: [user(2, { role: 'company_admin' })], page: 1, page_size: 25, total: 1 };
      if (path === '/company/invitations') return { data: [] };
      if (body)
        throw new ApiError(409, 'LAST_ADMIN', 'La empresa debe conservar un administrador activo');
      return null;
    };
    render(<UsersPanel timezone="America/Mazatlan" />);
    await userEvent.selectOptions(await screen.findByLabelText('Rol de Usuario 2'), 'operator');
    expect(
      await screen.findByText('La empresa debe conservar un administrador activo'),
    ).toBeTruthy();
  });
});

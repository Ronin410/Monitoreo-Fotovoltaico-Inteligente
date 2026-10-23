import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertDetail } from './alert-detail';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// Recharts necesita medidas reales; aquí basta con la tabla de la evidencia.
vi.mock('./evidence-chart', () => ({ EvidenceChart: () => <div>evidencia</div> }));

let role = 'operator';
let alert: Record<string, unknown>;
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
    if (path.endsWith('/acknowledge')) alert = { ...alert, status: 'acknowledged' };
    if (path.endsWith('/dismiss'))
      alert = {
        ...alert,
        status: 'dismissed',
        dismiss_reason: (opts?.body as { reason: string }).reason,
      };
    if (path.endsWith('/ticket')) return { id: ID(5) };
    return schema.parse(alert);
  },
);
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api,
    state: { status: 'authenticated', user: { role }, company: { timezone: 'America/Mazatlan' } },
  }),
  useCompanyTimezone: () => 'America/Mazatlan',
}));

beforeEach(() => {
  role = 'operator';
  calls.length = 0;
  alert = {
    id: ID(1),
    type: 'soiling',
    severity: 'warning',
    status: 'open',
    detected_at: '2026-10-21T13:00:00Z',
    resolved_at: null,
    resolution: null,
    ai_status: 'pending',
    ticket_id: null,
    plant: {
      id: ID(2),
      name: 'Comercial Centro',
      colonia: 'Centro',
      postal_code: '80000',
      client_name: 'Abarrotes El Sol',
    },
    dismiss_reason: null,
    evidence: {
      rule: 'soiling',
      trigger: { dates: ['2026-10-20', '2026-10-21'], deviation_pct: [14, 15.2] },
      baseline: { value: 0.86, source: 'own' },
      trend: { slope_pct_per_day: 0.4, days_since_reset: 38, last_reset: null },
      neighbors: { count: 4, neighbor_index: 0.99 },
    },
    ai_explanation: null,
    estimated_loss: { kwh_per_day: 6.4, mxn_per_day: 18.5, tariff_mxn_per_kwh: 2.9 },
  };
});

describe('detalle de alerta', () => {
  it('muestra desviación, vecinas y pérdida en kWh y pesos; sin IA, un aviso', async () => {
    render(<AlertDetail id={ID(1)} />);
    expect(await screen.findByRole('heading', { name: 'Posible suciedad' })).toBeTruthy();
    expect(screen.getByText('15.2 %')).toBeTruthy();
    expect(screen.getByText('Normal: PR 86.0 %')).toBeTruthy();
    expect(screen.getByText('99 %')).toBeTruthy();
    expect(screen.getByText('6.4 kWh/día')).toBeTruthy();
    expect(screen.getByText(/≈ \$19 MXN por día/)).toBeTruthy();
    expect(screen.getByText(/explicación automática aún no está disponible/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Regenerar explicación/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('con explicación IA válida muestra resumen, causa, confianza y qué revisar', async () => {
    alert.ai_explanation = {
      resumen: 'Rinde 15.2 % por debajo de su normal; lo más probable es polvo.',
      causa_probable: 'Acumulación de polvo',
      otras_causas: [],
      confianza: 'alta',
      que_revisar: ['Inspección visual de los paneles'],
    };
    render(<AlertDetail id={ID(1)} />);
    expect(await screen.findByText(/lo más probable es polvo/)).toBeTruthy();
    expect(screen.getByText('Acumulación de polvo')).toBeTruthy();
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Inspección visual de los paneles')).toBeTruthy();
  });

  it('reconocer y descartar con motivo', async () => {
    render(<AlertDetail id={ID(1)} />);
    await userEvent.click(await screen.findByRole('button', { name: /Marcar como vista/ }));
    expect(await screen.findByText('Vista')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Marcar como vista/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await userEvent.type(
      screen.getByLabelText(/¿Por qué se descarta\?/),
      'Sombra conocida del vecino',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Descartar alerta' }));
    expect(calls.find((c) => c.path.endsWith('/dismiss'))?.body).toEqual({
      reason: 'Sombra conocida del vecino',
    });
    expect(await screen.findByText(/Descartada: Sombra conocida del vecino/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Acciones' })).toBeNull();
  });

  it('crear ticket con técnico, fecha y prioridad lleva al ticket', async () => {
    render(<AlertDetail id={ID(1)} />);
    await userEvent.click(await screen.findByRole('button', { name: /Crear ticket/ }));
    await screen.findByRole('option', { name: 'Técnico Uno (técnico)' });
    await userEvent.selectOptions(screen.getByLabelText('Técnico asignado'), ID(9));
    await userEvent.type(screen.getByLabelText('Fecha programada'), '2026-10-24');
    await userEvent.click(screen.getByRole('button', { name: 'Crear ticket' }));
    expect(calls.find((c) => c.path.endsWith('/ticket'))?.body).toEqual({
      assigned_to: ID(9),
      scheduled_for: '2026-10-24',
      priority: 'normal',
    });
    expect(push).toHaveBeenCalledWith(`/tickets/${ID(5)}`);
  });

  it('sin permiso de gestión no hay acciones', async () => {
    role = 'technician';
    render(<AlertDetail id={ID(1)} />);
    await screen.findByRole('heading', { name: 'Posible suciedad' });
    expect(screen.queryByRole('group', { name: 'Acciones' })).toBeNull();
  });
});

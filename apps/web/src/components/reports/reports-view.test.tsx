import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportItem, ReportsList } from '@/lib/reports';
import { ReportsView } from './reports-view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calls: { path: string; method?: string; body?: unknown }[] = [];
let list: ReportsList;
const api = vi.fn(
  async (
    path: string,
    schema: { parse: (v: unknown) => unknown },
    opts?: { method?: string; body?: unknown },
  ) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    if (path.startsWith('/reports?')) return schema.parse(list);
    if (path === '/reports/generate') return schema.parse({ queued: 2, skipped_sent: 0 });
    if (path === '/reports/send-all') return schema.parse({ queued: 1, without_email: 0 });
    return schema.parse({ queued: true });
  },
);
// Doble de Response: el de jsdom no lee Blob.
const authFetch = vi.fn(async () => ({
  ok: true,
  blob: async () => new Blob(['%PDF-'], { type: 'application/pdf' }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ api, authFetch }),
  useCompanyTimezone: () => 'America/Mazatlan',
}));

const report = (status: 'pending' | 'generated' | 'sent', n: number) => ({
  id: ID(100 + n),
  status,
  narrative_source: 'ai' as const,
  has_pdf: status !== 'pending',
  sent_to: status === 'sent' ? 'c@x.mx' : null,
  sent_at: status === 'sent' ? '2026-10-01T16:00:00.000Z' : null,
  updated_at: '2026-10-01T15:00:00.000Z',
  send_failed: false,
});
const item = (n: number, name: string, over: Partial<ReportItem> = {}): ReportItem => ({
  client: { id: ID(n), name, report_email: `c${n}@x.mx` },
  plants: 1,
  report: null,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  list = {
    period: '2026-09',
    can_generate: true,
    auto_send: false,
    items: [
      item(1, 'Abarrotes El Sol', { report: report('generated', 1) }),
      item(2, 'Bodega Norte', { client: { id: ID(2), name: 'Bodega Norte', report_email: null } }),
      item(3, 'Casa Pérez', { report: report('sent', 3) }),
    ],
  };
  URL.createObjectURL = vi.fn(() => 'blob:pdf');
  URL.revokeObjectURL = vi.fn();
});

describe('pantalla de reportes', () => {
  it('muestra el estado de cada cliente y las acciones que corresponden', async () => {
    render(<ReportsView />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const [sol, bodega, casa] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(sol).getByText('Generado')).toBeTruthy();
    expect(within(sol).getByRole('button', { name: 'Enviar' })).toBeTruthy();
    expect(within(bodega).getByText('Sin generar')).toBeTruthy();
    expect(within(bodega).getByText(/Sin correo para reportes/)).toBeTruthy();
    expect(within(bodega).queryByRole('button', { name: 'Enviar' })).toBeNull();
    expect(within(casa).getByText('Enviado')).toBeTruthy();
    expect(within(casa).getByText(/Enviado a c@x.mx/)).toBeTruthy();
    // Un reporte enviado ya no se regenera.
    expect(within(casa).queryByRole('button', { name: 'Regenerar' })).toBeNull();
    expect(calls[0]?.path).toMatch(/^\/reports\?period=\d{4}-\d{2}$/);
  });

  it('genera, envía uno y envía todos con confirmación', async () => {
    render(<ReportsView />);
    const [sol, bodega] = (await screen.findAllByRole('listitem')) as [HTMLElement, HTMLElement];
    await userEvent.click(within(bodega).getByRole('button', { name: 'Generar' }));
    expect(calls.find((c) => c.path === '/reports/generate')).toMatchObject({
      method: 'POST',
      body: { client_ids: [ID(2)] },
    });

    await userEvent.click(within(sol).getByRole('button', { name: 'Enviar' }));
    expect(calls.some((c) => c.path === `/reports/${ID(101)}/send`)).toBe(true);
    expect(await screen.findByText('Enviando el reporte a c1@x.mx.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar todos (1)' }));
    expect(calls.some((c) => c.path === '/reports/send-all')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sí, enviar' }));
    expect(calls.find((c) => c.path === '/reports/send-all')?.body).toEqual({
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
  });

  it('abre la vista previa del PDF', async () => {
    render(<ReportsView />);
    const [sol] = (await screen.findAllByRole('listitem')) as [HTMLElement];
    await userEvent.click(within(sol).getByRole('button', { name: 'Ver PDF' }));
    const dialog = await screen.findByRole('dialog');
    expect(authFetch).toHaveBeenCalledWith(`/reports/${ID(101)}/pdf`, { method: 'GET' });
    expect(
      within(dialog)
        .getByTitle(/Abarrotes El Sol/)
        .getAttribute('src'),
    ).toBe('blob:pdf');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mes en curso o sin clientes: sin acciones de generar', async () => {
    list = { ...list, can_generate: false, items: [] };
    render(<ReportsView />);
    expect(await screen.findByText(/Ningún cliente tuvo plantas activas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Generar todos' })).toBeNull();
  });
});

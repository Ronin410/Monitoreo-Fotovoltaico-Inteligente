import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantView } from './assistant-view';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./chat-chart', () => ({
  ChatChart: ({ chart }: { chart: { title: string } }) => <div>gráfica: {chart.title}</div>,
}));

let exhausted = false;
const api = vi.fn(async (path: string, schema: { parse: (v: unknown) => unknown }) => {
  if (path.startsWith('/ai/conversations?'))
    return schema.parse({
      data: [],
      page: 1,
      page_size: 50,
      total: 0,
      budget: { used_ratio: 0.42, exhausted },
    });
  throw new Error(`sin respuesta para ${path}`);
});
const sse = (events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
const authFetch = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api,
    authFetch,
    state: { status: 'authenticated', user: { role: 'company_admin' } },
  }),
  useCompanyTimezone: () => 'America/Mazatlan',
}));

beforeEach(() => {
  exhausted = false;
  authFetch.mockReset();
});

describe('asistente', () => {
  it('pregunta sugerida: muestra la respuesta en streaming con enlaces a plantas y gráficas', async () => {
    authFetch.mockResolvedValue(
      sse([
        ['message_start', { conversation_id: ID(9) }],
        ['tool_status', { tool: 'rank_plants', label: 'Consultando ranking de plantas…' }],
        ['text_delta', { text: 'La peor es **Comercial Centro 21**' }],
        ['text_delta', { text: ' (PR 59 %).' }],
        [
          'chart',
          {
            type: 'bar',
            title: 'PR por planta',
            series: [{ name: 'PR', points: [{ x: 'A', y: 0.6 }] }],
          },
        ],
        ['message_end', { plants: [{ id: ID(21), name: 'Comercial Centro 21' }] }],
      ]),
    );
    render(<AssistantView />);
    expect(await screen.findByText('Uso de IA del mes: 42 % del presupuesto')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', {
        name: '¿Cuáles son las 5 plantas con peor rendimiento este mes?',
      }),
    );
    expect(authFetch).toHaveBeenCalledWith(
      '/ai/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          message: '¿Cuáles son las 5 plantas con peor rendimiento este mes?',
        }),
      }),
    );
    const link = await screen.findByRole('link', { name: 'Comercial Centro 21' });
    expect(link.getAttribute('href')).toBe(`/plants/${ID(21)}`);
    expect(screen.getByText(/\(PR 59 %\)\./)).toBeTruthy();
    expect(screen.getByText('gráfica: PR por planta')).toBeTruthy();

    // La siguiente pregunta sigue la misma conversación.
    authFetch.mockResolvedValue(
      sse([
        ['text_delta', { text: 'Sí.' }],
        ['message_end', { plants: [] }],
      ]),
    );
    await userEvent.type(screen.getByLabelText('Tu pregunta'), '¿Y la mejor?{Enter}');
    expect(JSON.parse(String(authFetch.mock.calls[1]?.[1].body))).toEqual({
      message: '¿Y la mejor?',
      conversation_id: ID(9),
    });
  });

  it('no enlaza direcciones externas que escriba el modelo', async () => {
    authFetch.mockResolvedValue(
      sse([
        ['text_delta', { text: 'Ve a [este sitio](https://malo.example).' }],
        ['message_end', { plants: [] }],
      ]),
    );
    render(<AssistantView />);
    await userEvent.type(await screen.findByLabelText('Tu pregunta'), 'Hola{Enter}');
    expect(await screen.findByText('este sitio')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'este sitio' })).toBeNull();
  });

  it('muestra el error de la API (límite por hora) y el del stream', async () => {
    authFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'CHAT_RATE_LIMIT', message: 'Máximo 30 mensajes por hora.' },
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    render(<AssistantView />);
    await userEvent.type(await screen.findByLabelText('Tu pregunta'), 'Hola{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('Máximo 30 mensajes por hora.');

    authFetch.mockResolvedValueOnce(
      sse([['error', { message: 'No se pudo completar la respuesta.' }]]),
    );
    await userEvent.type(screen.getByLabelText('Tu pregunta'), 'Otra{Enter}');
    const chat = screen.getByRole('region', { name: 'Chat' });
    expect(await within(chat).findByText('No se pudo completar la respuesta.')).toBeTruthy();
  });

  it('con el presupuesto agotado no deja preguntar', async () => {
    exhausted = true;
    render(<AssistantView />);
    expect(await screen.findByText(/Se agotó el presupuesto de IA/)).toBeTruthy();
    expect(screen.queryByLabelText('Tu pregunta')).toBeNull();
  });
});

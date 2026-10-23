import { describe, expect, it } from 'vitest';
import { MockLLMProvider, type MockReply } from '../mock.js';
import type { LLMContentBlock, LLMRequest } from '../provider.js';
import type { ToolRun } from '../tools/index.js';
import { plantsIn, runChatTurn, type ChatEvent } from './agent.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as const;

function turn(replies: MockReply[], runTool: (name: string, input: unknown) => Promise<ToolRun>) {
  const provider = new MockLLMProvider(() => replies.shift());
  const events: ChatEvent[] = [];
  const done = runChatTurn({
    provider,
    model: 'chat',
    system: 'sistema',
    tools: [{ name: 'rank_plants', description: 'r', inputSchema: { type: 'object' } }],
    history: [{ role: 'assistant', content: 'Hola' }],
    message: '¿Cuáles son las peores?',
    runTool,
    emit: (e) => events.push(e),
  });
  return { provider, events, done };
}

describe('ciclo agente del chat', () => {
  it('pide una herramienta, recibe el resultado y responde; junta las plantas para enlazarlas', async () => {
    const calls: unknown[] = [];
    const { provider, events, done } = turn(
      [
        {
          content: [
            { type: 'text', text: 'Reviso el ranking.' },
            toolUse('t1', 'rank_plants', { metric: 'pr_temp' }),
          ],
          stopReason: 'tool_use',
        },
        'La peor es Comercial Centro 21.',
      ],
      async (name, input) => {
        calls.push({ name, input });
        return {
          ok: true,
          input,
          output: { plants: [{ plant_id: ID(1), name: 'Comercial Centro 21', value: 0.59 }] },
        };
      },
    );
    const r = await done;
    expect(calls).toEqual([{ name: 'rank_plants', input: { metric: 'pr_temp' } }]);
    expect(r.text).toBe('Reviso el ranking.\n\nLa peor es Comercial Centro 21.');
    expect(r.plants).toEqual([{ id: ID(1), name: 'Comercial Centro 21' }]);
    expect(r.usage).toHaveLength(2);
    expect(r.toolCalls[0]?.summary).toMatchObject({
      ok: true,
      preview: expect.stringContaining('0.59'),
    });
    // El separador entre rondas va con el primer texto de la ronda: el estado de la herramienta
    // queda visible hasta que llega la respuesta.
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'tool_status', 'text_delta']);
    expect(events[2]).toEqual({ type: 'text_delta', text: '\n\nLa peor es Comercial Centro 21.' });
    expect(events[1]).toEqual({
      type: 'tool_status',
      tool: 'rank_plants',
      label: 'Consultando ranking de plantas…',
    });
    // Segunda llamada: el turno del asistente con la herramienta y todos los resultados juntos.
    const second = provider.requests[1] as LLMRequest;
    expect(second.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: JSON.stringify({
            plants: [{ plant_id: ID(1), name: 'Comercial Centro 21', value: 0.59 }],
          }),
        },
      ],
    });
    expect(second).toMatchObject({ effort: 'medium', refusalFallback: true });
  });

  it('los errores de herramienta vuelven al modelo como is_error para que corrija', async () => {
    const { provider, done } = turn(
      [
        { content: [toolUse('t1', 'rank_plants', { metric: 'x' })], stopReason: 'tool_use' },
        'Listo.',
      ],
      async () => ({ ok: false, error: 'Entrada inválida: metric' }),
    );
    const r = await done;
    const blocks = (provider.requests[1] as LLMRequest).messages.at(-1)
      ?.content as LLMContentBlock[];
    expect(blocks[0]).toMatchObject({ is_error: true, content: 'Entrada inválida: metric' });
    expect(r.toolCalls[0]?.summary).toEqual({ ok: false, error: 'Entrada inválida: metric' });
  });

  it('máximo 3 gráficas por respuesta', async () => {
    const chart = {
      type: 'line',
      title: 'T',
      x_label: '',
      y_label: '',
      series: [{ name: 's', points: [{ x: 1, y: 1 }] }],
    };
    const uses = [1, 2, 3, 4].map((i) => toolUse(`c${i}`, 'render_chart', chart));
    const { events, done } = turn(
      [{ content: uses, stopReason: 'tool_use' }, 'Aquí están.'],
      async (_n, input) => ({ ok: true, input, output: { ok: true } }),
    );
    const r = await done;
    expect(r.charts).toHaveLength(3);
    expect(events.filter((e) => e.type === 'chart')).toHaveLength(3);
    expect(r.toolCalls[3]?.summary.error).toBe('Máximo 3 gráficas por respuesta.');
  });

  it('límite de 6 rondas de herramientas; si insiste, termina con un aviso', async () => {
    let runs = 0;
    const always = { content: [toolUse('t', 'rank_plants', {})], stopReason: 'tool_use' as const };
    const { provider, done } = turn(
      Array.from({ length: 10 }, () => always),
      async (_n, input) => {
        runs += 1;
        return { ok: true, input, output: {} };
      },
    );
    const r = await done;
    expect(runs).toBe(6);
    expect(provider.requests).toHaveLength(8);
    expect(r.text).toContain('No pude terminar la consulta');
  });

  it('negativa del modelo', async () => {
    const { done } = turn([{ content: [], stopReason: 'refusal' }], async () => ({
      ok: true,
      input: {},
      output: {},
    }));
    expect((await done).text).toBe('No puedo ayudar con esa solicitud.');
  });

  it('plantsIn encuentra plantas en las formas de salida de las herramientas', () => {
    expect(
      plantsIn({
        plants: [{ id: ID(1), name: 'A' }],
        plant: { id: ID(2), name: 'B' },
        alerts: [{ plant_id: ID(3), plant: 'C' }],
        zones: [{ zone: 'Centro', name: 'no es planta' }],
      }),
    ).toEqual([
      { id: ID(1), name: 'A' },
      { id: ID(2), name: 'B' },
      { id: ID(3), name: 'C' },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import { explainAlert } from './explanation/explain.js';
import { explanationSchema, type ExplainInput } from './explanation/schema.js';
import { templateExplanation } from './explanation/template.js';
import { numbersIn, unsupportedFigures } from './figures.js';
import { MockLLMProvider } from './mock.js';
import { LLMError, type LLMRequest } from './provider.js';

const NOW = new Date('2026-10-23T05:00:00Z');

const input = (over: Partial<ExplainInput['alert']> = {}): ExplainInput => ({
  alert: { type: 'soiling', severity: 'warning', detected_at: '2026-10-21T05:00:00Z', ...over },
  evidence: {
    rule: 'soiling',
    trigger: { dates: ['2026-10-19', '2026-10-20', '2026-10-21'], deviation_pct: [13.1, 14, 15.2] },
    baseline: { value: 0.86, source: 'own' },
    neighbors: { count: 6, neighbor_index: 0.97 },
    weather: { rain_mm_14d: 0 },
    estimated_loss_kwh_per_day: 6.4,
    estimated_loss_mxn_per_day: 18.6,
  },
  plant: {
    capacity_kwp: 10,
    tilt_deg: 20,
    azimuth_deg: 180,
    age_years: 2,
    inverter_brand: 'growatt',
  },
  events: [{ type: 'rain_cleaning', date: '2026-09-20' }],
  tickets: [],
  today: '2026-10-23',
});

const answer = (resumen: string, extra: object = {}) =>
  JSON.stringify({
    resumen,
    causa_probable: 'Acumulación de polvo',
    otras_causas: ['Sombra nueva'],
    confianza: 'alta',
    que_revisar: ['Inspección visual', 'Lavar y verificar la recuperación en 1–2 días'],
    urgencia: 'media',
    ...extra,
  });

describe('validador de cifras', () => {
  it('lee números en formato es-MX', () => {
    expect(numbersIn('rinde 15.2 % y perdió 1,234.5 kWh').map((n) => n.value)).toEqual([
      15.2, 1234.5,
    ]);
  });

  it('acepta cifras de la evidencia, redondeadas o como porcentaje de una fracción', () => {
    const ev = input();
    expect(unsupportedFigures(['Rinde 15 % por debajo (15.2 %), PR normal de 86 %.'], ev)).toEqual(
      [],
    );
    expect(
      unsupportedFigures(['Pierde 6.4 kWh, unos $19 por día, desde el 21 de octubre de 2026.'], ev),
    ).toEqual([]);
    expect(
      unsupportedFigures(['Lavar y revisar en 1–2 días; planta de 10 kWp con 6 vecinas.'], ev),
    ).toEqual([]);
  });

  it('rechaza cifras inventadas', () => {
    expect(unsupportedFigures(['Rinde 23 % por debajo y pierde 9.9 kWh.'], input())).toEqual([
      '23',
      '9.9',
    ]);
    // Un porcentaje no puede salir de una fecha (2026-10-21) ni de un conteo.
    expect(unsupportedFigures(['Cayó 21 % desde el 21 de octubre.'], input())).toEqual(['21']);
    // 15.2 redondeado a 1 decimal es 15.2, no 15.3.
    expect(unsupportedFigures(['Rinde 15.3 % por debajo.'], input())).toEqual(['15.3']);
  });
});

describe('explicación de alertas', () => {
  it('respuesta válida: se guarda la de la IA con el modelo y el uso', async () => {
    const provider = new MockLLMProvider(() =>
      answer('Rinde 15 % por debajo de su normal; parece polvo.'),
    );
    const r = await explainAlert(provider, 'claude-haiku-5-5', input(), NOW);
    expect(r.failure).toBeNull();
    expect(r.explanation).toMatchObject({
      generated_by: 'ai',
      model: 'claude-haiku-5-5',
      confianza: 'alta',
    });
    expect(r.usage).toHaveLength(1);
    const req = provider.requests[0] as LLMRequest;
    expect(req).toMatchObject({ effort: 'low', jsonSchema: { type: 'object' } });
    expect(req).not.toHaveProperty('temperature');
    expect(req.messages[0]?.content).toContain('"deviation_pct":[13.1,14,15.2]');
  });

  it('una cifra inventada se reintenta una vez indicando cuál; si se corrige, se usa', async () => {
    const replies = [answer('Rinde 23 % por debajo.'), answer('Rinde 15 % por debajo.')];
    const provider = new MockLLMProvider(() => replies.shift());
    const r = await explainAlert(provider, 'm', input(), NOW);
    expect(r.explanation.generated_by).toBe('ai');
    expect(r.usage).toHaveLength(2);
    expect(provider.requests[1]?.messages[0]?.content).toContain(
      'estas cifras no están en los datos: 23',
    );
  });

  it('CA F7: con el proveedor simulado devolviendo una cifra inventada, se usa la plantilla', async () => {
    const provider = new MockLLMProvider(() => answer('Pierde 42 kWh al día.'));
    const r = await explainAlert(provider, 'm', input(), NOW);
    expect(provider.requests).toHaveLength(2);
    expect(r.explanation).toMatchObject({
      generated_by: 'template',
      model: null,
      causa_probable: 'Acumulación de polvo',
    });
    expect(r.failure).toContain('42');
    expect(r.usage).toHaveLength(2);
  });

  it('JSON inválido o campos fuera de esquema también se reintentan', async () => {
    const replies = ['no es json', answer('x'.repeat(300))];
    const r = await explainAlert(new MockLLMProvider(() => replies.shift()), 'm', input(), NOW);
    expect(r.explanation.generated_by).toBe('template');
    expect(r.failure).toContain('resumen');
  });

  it('proveedor caído o negativa del modelo: plantilla sin reintentar', async () => {
    const down = new MockLLMProvider(() => new LLMError('unavailable', 'No disponible'));
    expect((await explainAlert(down, 'm', input(), NOW)).failure).toBe('No disponible');
    expect(down.requests).toHaveLength(1);
    const refused = new MockLLMProvider(() => ({ content: [], stopReason: 'refusal' }));
    const r = await explainAlert(refused, 'm', input(), NOW);
    expect(r).toMatchObject({
      failure: 'El modelo declinó la solicitud',
      usage: [expect.anything()],
    });
  });

  it('la plantilla de cada tipo cumple el esquema y menciona la pérdida', () => {
    for (const type of ['soiling', 'sudden_drop', 'offline', 'cleaning_due_soon'] as const) {
      const t = templateExplanation(input({ type, severity: 'critical' }));
      expect(explanationSchema.safeParse(t).success).toBe(true);
      expect(t.resumen).toContain('6.4 kWh');
    }
    expect(templateExplanation(input()).resumen).toContain('15.2 % por debajo');
    const notRecovered = input();
    notRecovered.evidence.cleaning_did_not_recover = true;
    expect(templateExplanation(notRecovered).resumen).toContain('después de un lavado');
  });
});

describe('proveedor de Anthropic', () => {
  const ok = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: '{"a":1}' },
      { type: 'tool_use', id: 't1', name: 'rank_plants', input: { limit: 5 } },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 0,
    },
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('caché en el sistema y las herramientas, salida estructurada y esfuerzo; sin temperatura', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json(200, ok));
    const p = new AnthropicProvider({ apiKey: 'k', fetch: fetchFn });
    const res = await p.generate({
      model: 'claude-haiku-5-5',
      system: 'sistema',
      messages: [{ role: 'user', content: 'hola' }],
      tools: [
        { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } },
      ],
      maxTokens: 1000,
      effort: 'low',
      jsonSchema: { type: 'object' },
    });
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body.system).toEqual([
      { type: 'text', text: 'sistema', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(res).toEqual({
      content: [
        { type: 'text', text: '{"a":1}' },
        { type: 'tool_use', id: 't1', name: 'rank_plants', input: { limit: 5 } },
      ],
      stopReason: 'tool_use',
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
    });
  });

  it('un 5xx se reintenta una sola vez y termina en LLMError sin detalles', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json(500, { type: 'error', error: { type: 'api_error', message: 'interno sk-secreto' } }),
    );
    const p = new AnthropicProvider({ apiKey: 'k', fetch: fetchFn });
    const err = await p
      .generate({
        model: 'm',
        system: 's',
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 10,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err).toMatchObject({ kind: 'unavailable' });
    expect(String((err as Error).message)).not.toContain('secreto');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('con refusalFallback usa el respaldo del servidor (beta) e ignora los bloques de cambio', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json(200, {
        ...ok,
        content: [
          { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
          { type: 'text', text: 'hola' },
        ],
        stop_reason: 'end_turn',
      }),
    );
    const p = new AnthropicProvider({ apiKey: 'k', fetch: fetchFn });
    const res = await p.generate({
      model: 'claude-sonnet-5-5',
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10,
      refusalFallback: true,
    });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ fallbacks: 'default' });
    expect(new Headers(init?.headers).get('anthropic-beta')).toContain(
      'server-side-fallback-2026-07-01',
    );
    expect(res.content).toEqual([{ type: 'text', text: 'hola' }]);
  });

  it('400 no se reintenta', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'x' } }),
    );
    const p = new AnthropicProvider({ apiKey: 'k', fetch: fetchFn });
    await expect(
      p.generate({
        model: 'm',
        system: 's',
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 10,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

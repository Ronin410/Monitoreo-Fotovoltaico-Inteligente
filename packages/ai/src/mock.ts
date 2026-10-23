import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './provider.js';
import { LLMError } from './provider.js';

// Proveedor simulado (LLM_PROVIDER=mock y pruebas): responde con lo que indique `respond`. Sin
// respuesta configurada falla como un proveedor caído, así lo que depende de la IA usa su
// plantilla de respaldo.

export type MockReply = string | Omit<LLMResponse, 'model' | 'usage'> | LLMError;

export class MockLLMProvider implements LLMProvider {
  readonly requests: LLMRequest[] = [];

  constructor(
    private readonly respond: (req: LLMRequest) => MockReply | undefined = () => undefined,
  ) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    const reply = this.respond(req);
    if (reply === undefined)
      throw new LLMError('unavailable', 'Proveedor de IA simulado sin respuesta');
    if (reply instanceof LLMError) throw reply;
    const base =
      typeof reply === 'string'
        ? { content: [{ type: 'text' as const, text: reply }], stopReason: 'end_turn' as const }
        : reply;
    return {
      ...base,
      model: req.model,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const response = await this.generate(req);
    for (const b of response.content)
      if (b.type === 'text') yield { type: 'text_delta', text: b.text };
    yield { type: 'message_end', response };
  }
}

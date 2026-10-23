import Anthropic from '@anthropic-ai/sdk';
import {
  LLMError,
  type LLMRequest,
  type LLMResponse,
  type LLMStopReason,
  type LLMStreamEvent,
  type LLMProvider,
} from './provider.js';

// LLMProvider sobre la API de Claude con el SDK oficial (specs/07 §1): caché del prompt de sistema
// y de las herramientas (se repiten en cada llamada), 60 s por llamada y un reintento ante error
// 5xx o de red (el SDK reintenta 408/409/429/5xx y errores de conexión).

const TIMEOUT_MS = 60_000;
const EPHEMERAL = { type: 'ephemeral' } as const;

function toParams(req: LLMRequest): Anthropic.MessageCreateParamsNonStreaming {
  const tools: Anthropic.Tool[] | undefined = req.tools?.map((t, i, all) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    // Un punto de caché al final de las herramientas cubre todas.
    ...(i === all.length - 1 && { cache_control: EPHEMERAL }),
  }));
  const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b): Anthropic.ContentBlockParam => {
            if (b.type === 'text') return { type: 'text', text: b.text };
            if (b.type === 'tool_use')
              return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
            return {
              type: 'tool_result',
              tool_use_id: b.tool_use_id,
              content: b.content,
              ...(b.is_error && { is_error: true }),
            };
          }),
  }));
  const outputConfig: Anthropic.OutputConfig = {
    ...(req.effort && { effort: req.effort }),
    ...(req.jsonSchema && { format: { type: 'json_schema', schema: req.jsonSchema } }),
  };
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: 'text', text: req.system, cache_control: EPHEMERAL }],
    messages,
    ...(tools && tools.length > 0 && { tools }),
    ...(Object.keys(outputConfig).length > 0 && { output_config: outputConfig }),
  };
}

function stopReason(r: Anthropic.StopReason | null): LLMStopReason {
  return r === 'end_turn' || r === 'tool_use' || r === 'max_tokens' || r === 'refusal'
    ? r
    : r === 'stop_sequence'
      ? 'end_turn'
      : 'other';
}

function toResponse(msg: Anthropic.Message): LLMResponse {
  const content: LLMResponse['content'] = [];
  for (const b of msg.content) {
    if (b.type === 'text') content.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use')
      content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    // Los bloques de razonamiento no se usan ni se guardan.
  }
  return {
    content,
    stopReason: stopReason(msg.stop_reason),
    model: msg.model,
    usage: {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/** Error del SDK → LLMError, del más específico al más general. */
export function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new LLMError('timeout', 'El proveedor de IA no respondió a tiempo');
  if (err instanceof Anthropic.APIConnectionError)
    return new LLMError('unavailable', 'No se pudo conectar con el proveedor de IA');
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return new LLMError('auth', 'Credenciales del proveedor de IA inválidas');
  if (err instanceof Anthropic.RateLimitError)
    return new LLMError('rate_limit', 'Límite de uso del proveedor de IA');
  if (err instanceof Anthropic.BadRequestError)
    return new LLMError('invalid_request', 'Solicitud inválida al proveedor de IA');
  if (err instanceof Anthropic.InternalServerError)
    return new LLMError('unavailable', 'El proveedor de IA no está disponible');
  if (err instanceof Anthropic.APIError)
    return new LLMError('unknown', `Error del proveedor de IA (${err.status ?? 'sin estado'})`);
  return new LLMError('unknown', 'Error inesperado del proveedor de IA');
}

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; baseURL?: string; fetch?: typeof fetch }) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL && { baseURL: opts.baseURL }),
      ...(opts.fetch && { fetch: opts.fetch }),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    try {
      return toResponse(await this.client.messages.create(toParams(req)));
    } catch (err) {
      throw toLLMError(err);
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamEvent> {
    try {
      const stream = this.client.messages.stream(toParams(req));
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }
      yield { type: 'message_end', response: toResponse(await stream.finalMessage()) };
    } catch (err) {
      throw toLLMError(err);
    }
  }
}

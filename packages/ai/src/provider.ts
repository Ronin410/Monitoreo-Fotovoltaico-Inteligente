// Capa de proveedor de IA (specs/07 §1). El resto del sistema habla con LLMProvider; la
// implementación de Anthropic y la simulada viven detrás. La IA interpreta y redacta: las cifras
// siempre vienen de nuestro código.

export type LLMTextBlock = { type: 'text'; text: string };
export type LLMToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type LLMToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type LLMContentBlock = LLMTextBlock | LLMToolUseBlock | LLMToolResultBlock;

export type LLMMessage = {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema del input. */
  inputSchema: Record<string, unknown>;
};

export type LLMRequest = {
  model: string;
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
  /** Profundidad del razonamiento; los modelos actuales no aceptan `temperature`. */
  effort?: 'low' | 'medium' | 'high';
  /** Salida estructurada: la respuesta es un JSON que cumple este JSON Schema. */
  jsonSchema?: Record<string, unknown>;
};

export type LLMUsage = {
  /** Tokens de entrada sin caché. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type LLMResponse = {
  content: (LLMTextBlock | LLMToolUseBlock)[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
  model: string;
};

export type LLMStreamEvent =
  { type: 'text_delta'; text: string } | { type: 'message_end'; response: LLMResponse };

export interface LLMProvider {
  generate(req: LLMRequest): Promise<LLMResponse>;
  stream(req: LLMRequest): AsyncIterable<LLMStreamEvent>;
}

export type LLMErrorKind =
  'timeout' | 'rate_limit' | 'unavailable' | 'invalid_request' | 'auth' | 'unknown';

/** Error del proveedor, sin detalles internos (el mensaje puede llegar a job_runs). */
export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** Texto de la respuesta (bloques de texto unidos). */
export function responseText(res: LLMResponse): string {
  return res.content
    .filter((b): b is LLMTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Tokens que cuentan para el presupuesto: entrada (con caché) más salida. */
export const totalInputTokens = (u: LLMUsage) =>
  u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;

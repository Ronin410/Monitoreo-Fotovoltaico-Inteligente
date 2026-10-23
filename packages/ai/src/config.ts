import { AnthropicProvider } from './anthropic.js';
import { MockLLMProvider } from './mock.js';
import type { LLMProvider } from './provider.js';

// Proveedor y modelos de IA según el entorno (specs/07 §1: LLM_MODEL_CHAT para el chat y
// LLM_MODEL_FAST para explicaciones y narrativas).

export type AiConfig = {
  provider: LLMProvider;
  /** Chat del asistente. */
  chatModel: string;
  /** Explicaciones de alertas y narrativas de reportes. */
  fastModel: string;
};

export function createAiConfig(env: {
  LLM_PROVIDER: 'anthropic' | 'mock';
  ANTHROPIC_API_KEY?: string | undefined;
  LLM_MODEL_CHAT: string;
  LLM_MODEL_FAST: string;
}): AiConfig {
  return {
    provider:
      env.LLM_PROVIDER === 'anthropic'
        ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY ?? '' })
        : new MockLLMProvider(),
    chatModel: env.LLM_MODEL_CHAT,
    fastModel: env.LLM_MODEL_FAST,
  };
}

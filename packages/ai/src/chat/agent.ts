import { TOOL_STATUS } from '../prompts/chat.js';
import {
  type LLMContentBlock,
  type LLMMessage,
  type LLMProvider,
  type LLMToolUseBlock,
  type LLMUsage,
  type ToolDefinition,
} from '../provider.js';
import type { ChartSpec, ToolRun } from '../tools/index.js';

// Ciclo agente del chat (specs/07 §2): el modelo pide herramientas, el servidor las ejecuta en la
// empresa de la sesión y devuelve resultados, hasta 6 rondas. Emite eventos para el streaming.

export const MAX_TOOL_ROUNDS = 6;
export const MAX_CHARTS = 3;
/** Tope de un resultado de herramienta para el modelo. */
const MAX_RESULT_CHARS = 30_000;
const PREVIEW_CHARS = 1_000;

export type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_status'; tool: string; label: string }
  | { type: 'chart'; chart: ChartSpec };

export type ToolCallRecord = {
  name: string;
  input: unknown;
  /** Resumen de la salida (no la salida cruda) para guardar en ai_messages. */
  summary: { ok: boolean; error?: string; chars?: number; preview?: string };
};

export type ChatTurnResult = {
  text: string;
  charts: ChartSpec[];
  /** Plantas que aparecieron en los datos: la pantalla convierte sus nombres en enlaces. */
  plants: { id: string; name: string }[];
  toolCalls: ToolCallRecord[];
  usage: LLMUsage[];
  model: string | null;
  rounds: number;
};

/** Plantas con id y nombre en la salida de una herramienta. */
export function plantsIn(output: unknown): { id: string; name: string }[] {
  const found = new Map<string, string>();
  const walk = (v: unknown, key: string | null) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.plant_id === 'string' && typeof (o.name ?? o.plant) === 'string')
        found.set(o.plant_id, String(o.name ?? o.plant));
      else if (
        (key === 'plant' || key === 'plants') &&
        typeof o.id === 'string' &&
        typeof o.name === 'string'
      )
        found.set(o.id, o.name);
      for (const [k, x] of Object.entries(o)) walk(x, k);
    }
  };
  walk(output, null);
  return [...found].map(([id, name]) => ({ id, name }));
}

export async function runChatTurn(opts: {
  provider: LLMProvider;
  model: string;
  system: string;
  tools: ToolDefinition[];
  history: LLMMessage[];
  message: string;
  runTool: (name: string, input: unknown) => Promise<ToolRun>;
  emit: (e: ChatEvent) => void;
  maxRounds?: number;
}): Promise<ChatTurnResult> {
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;
  const messages: LLMMessage[] = [...opts.history, { role: 'user', content: opts.message }];
  const result: ChatTurnResult = {
    text: '',
    charts: [],
    plants: [],
    toolCalls: [],
    usage: [],
    model: null,
    rounds: 0,
  };
  const plants = new Map<string, string>();
  const say = (text: string) => {
    result.text += text;
    opts.emit({ type: 'text_delta', text });
  };

  for (let round = 0; ; round++) {
    // Separa el texto de cada ronda ("Voy a consultar…" y la respuesta), junto con el primer
    // texto de la ronda: así el estado de la herramienta se ve hasta que llega la respuesta.
    let separator = round > 0 && result.text !== '' && !result.text.endsWith('\n') ? '\n\n' : '';
    let response = null;
    for await (const event of opts.provider.stream({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      maxTokens: 16_000,
      effort: 'medium',
      refusalFallback: true,
    })) {
      if (event.type === 'text_delta') {
        say(separator + event.text);
        separator = '';
      } else response = event.response;
    }
    if (!response) throw new Error('El proveedor de IA no terminó la respuesta');
    result.usage.push(response.usage);
    result.model = response.model;
    result.rounds = round + 1;

    if (response.stopReason === 'refusal') {
      say('No puedo ayudar con esa solicitud.');
      break;
    }
    if (response.stopReason === 'max_tokens') {
      say('\n\n(La respuesta quedó incompleta por su longitud.)');
      break;
    }
    const uses = response.content.filter((b): b is LLMToolUseBlock => b.type === 'tool_use');
    if (response.stopReason !== 'tool_use' || uses.length === 0) break;
    if (round > maxRounds) {
      say(
        'No pude terminar la consulta con los datos disponibles. Intenta una pregunta más concreta.',
      );
      break;
    }

    const results: LLMContentBlock[] = [];
    for (const use of uses) {
      opts.emit({
        type: 'tool_status',
        tool: use.name,
        label: TOOL_STATUS[use.name] ?? 'Consultando…',
      });
      let run: ToolRun;
      if (round >= maxRounds) {
        run = {
          ok: false,
          error: 'Se alcanzó el límite de consultas; responde con lo que ya tienes.',
        };
      } else if (use.name === 'render_chart' && result.charts.length >= MAX_CHARTS) {
        run = { ok: false, error: `Máximo ${MAX_CHARTS} gráficas por respuesta.` };
      } else {
        run = await opts.runTool(use.name, use.input);
      }
      if (run.ok && use.name === 'render_chart') {
        const chart = run.input as ChartSpec;
        result.charts.push(chart);
        opts.emit({ type: 'chart', chart });
      }
      let content: string;
      if (run.ok) {
        for (const p of plantsIn(run.output)) plants.set(p.id, p.name);
        const json = JSON.stringify(run.output);
        content =
          json.length > MAX_RESULT_CHARS
            ? `${json.slice(0, MAX_RESULT_CHARS)}… (resultado recortado; pide menos elementos)`
            : json;
        result.toolCalls.push({
          name: use.name,
          input: run.input,
          summary: { ok: true, chars: json.length, preview: json.slice(0, PREVIEW_CHARS) },
        });
      } else {
        content = run.error;
        result.toolCalls.push({
          name: use.name,
          input: use.input,
          summary: { ok: false, error: run.error },
        });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content,
        ...(!run.ok && { is_error: true }),
      });
    }
    // Todos los resultados en un solo mensaje del usuario.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });
  }
  result.plants = [...plants].map(([id, name]) => ({ id, name }));
  if (!result.text.trim()) say('No obtuve una respuesta. Intenta de nuevo.');
  return result;
}

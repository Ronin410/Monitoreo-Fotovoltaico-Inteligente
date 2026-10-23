import { z } from 'zod';

// Asistente (espejo de apps/api/src/routes/ai/schemas.ts) y lectura del streaming SSE.

export const chartSpecSchema = z.object({
  type: z.enum(['bar', 'line']),
  title: z.string(),
  x_label: z.string().default(''),
  y_label: z.string().default(''),
  series: z.array(
    z.object({
      name: z.string(),
      points: z.array(z.object({ x: z.union([z.string(), z.number()]), y: z.number().nullable() })),
    }),
  ),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

const plantRef = z.object({ id: z.uuid(), name: z.string() });
export type PlantRef = z.infer<typeof plantRef>;

export const conversationsResponse = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      title: z.string().nullable(),
      last_message_at: z.string(),
      created_at: z.string(),
    }),
  ),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  budget: z.object({ used_ratio: z.number(), exhausted: z.boolean() }),
});
export type ConversationSummary = z.infer<typeof conversationsResponse>['data'][number];

export const conversationDetail = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      charts: z.array(chartSpecSchema),
      plants: z.array(plantRef),
      created_at: z.string(),
    }),
  ),
});

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  charts: ChartSpec[];
  plants: PlantRef[];
  /** Mientras llega la respuesta. */
  streaming?: boolean;
  /** Estado de la herramienta en curso ("Consultando ranking de plantas…"). */
  status?: string | null;
  error?: string | null;
};

/** Preguntas sugeridas al abrir (specs/07 §2). */
export const SUGGESTED_QUESTIONS = [
  '¿Qué plantas van a necesitar lavado en las próximas 2 semanas?',
  '¿Cuáles son las 5 plantas con peor rendimiento este mes?',
  '¿Qué colonias están generando más por kWp instalado?',
  '¿Qué alertas críticas tengo abiertas?',
  'Compara la generación de septiembre contra agosto.',
];

export const MAX_MESSAGE = 2_000;

export type SseEvent = { event: string; data: unknown };

/** Lee un cuerpo SSE y entrega cada evento completo (`event:` + `data:` + línea en blanco). */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    try {
      onEvent({ event, data: JSON.parse(data.join('\n')) });
    } catch {
      // Un evento que no es JSON se ignora.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      flush(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
  }
  if (buffer.trim()) flush(buffer);
}

/**
 * Convierte en enlaces los nombres de planta que aparecieron en los datos. Escapa los nombres
 * para markdown: un nombre es dato, nunca formato.
 */
export function linkPlants(text: string, plants: PlantRef[]): string {
  if (plants.length === 0) return text;
  const byName = new Map(plants.map((p) => [p.name, p.id]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  return text.replace(pattern, (name, offset: number, whole: string) => {
    // Si ya es el texto de un enlace, se deja.
    if (
      whole[offset - 1] === '[' &&
      whole.slice(offset + name.length, offset + name.length + 2) === ']('
    )
      return name;
    const label = name.replace(/([\\[\]*_`])/g, '\\$1');
    return `[${label}](/plants/${byName.get(name)})`;
  });
}

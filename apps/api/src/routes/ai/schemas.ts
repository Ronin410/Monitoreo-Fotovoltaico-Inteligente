import { chartSchema } from '@pv/ai';
import { z } from 'zod';
import { paginatedSchema, paginationQuery } from '../../http/pagination.js';

// Asistente IA (specs/07 §2, specs/10 §Asistente IA).

export const MAX_CHAT_MESSAGE = 2_000;

export const chatBody = z.object({
  conversation_id: z.uuid().optional(),
  message: z
    .string({ error: 'Escribe tu pregunta' })
    .trim()
    .min(1, 'Escribe tu pregunta')
    .max(MAX_CHAT_MESSAGE, `Máximo ${MAX_CHAT_MESSAGE} caracteres`),
});

export const conversationsQuery = paginationQuery;

/** Contenido guardado de un mensaje (ai_messages.content). */
export const storedContent = z.object({
  text: z.string().default(''),
  charts: z.array(chartSchema).default([]),
  plants: z.array(z.object({ id: z.uuid(), name: z.string() })).default([]),
});

const conversation = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  last_message_at: z.date(),
  created_at: z.date(),
});

export const conversationsResponse = paginatedSchema(conversation).extend({
  /** Presupuesto del mes: el chat se pausa al agotarse (specs/07 §Límites). */
  budget: z.object({ used_ratio: z.number(), exhausted: z.boolean() }),
});

export const conversationDetail = conversation.extend({
  messages: z.array(
    z.object({
      id: z.uuid(),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      charts: z.array(chartSchema),
      plants: z.array(z.object({ id: z.uuid(), name: z.string() })),
      created_at: z.date(),
    }),
  ),
});

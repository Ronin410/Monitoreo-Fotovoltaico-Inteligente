import { notificationsSend, type JobEnqueuer } from '@pv/adapters';
import {
  ASSISTANT_TOOLS,
  budgetStatus,
  chatSystemPrompt,
  queueBudgetWarning,
  recordUsage,
  runChatTurn,
  runTool,
  toolDefinitions,
  totalInputTokens,
  type AiConfig,
  type ChatEvent,
  type LLMMessage,
} from '@pv/ai';
import { localDate } from '@pv/core';
import { withTenant, type Prisma, type PrismaClient } from '@pv/db';
import { Router, type Response } from 'express';
import type { Logger } from 'pino';
import { companyAuthOf, requirePermission } from '../../auth/authorize.js';
import { HttpError } from '../../http/errors.js';
import { pageArgs, paginated } from '../../http/pagination.js';
import { respond } from '../../http/respond.js';
import { idParam } from '../shared-schemas.js';
import {
  chatBody,
  conversationDetail,
  conversationsQuery,
  conversationsResponse,
  storedContent,
} from './schemas.js';

// Asistente analítico (F8-T2, specs/07 §2): POST /ai/chat responde por SSE con el ciclo agente;
// las conversaciones son de cada usuario (ni otros usuarios de la empresa las ven).

/** specs/07 §Límites: 30 mensajes por hora por usuario. */
export const CHAT_MESSAGES_PER_HOUR = 30;
/** Mensajes previos que se mandan al modelo (solo texto y gráficas, sin resultados de herramientas). */
const HISTORY_MESSAGES = 20;
const TITLE_CHARS = 60;
const HOUR_MS = 3_600_000;

const conversationNotFound = () => new HttpError(404, 'NOT_FOUND', 'Conversación no encontrada');

/** Escribe un evento SSE. */
function sse(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Historial para el modelo: lo que vio el usuario, sin las salidas crudas de herramientas. */
function historyMessages(
  rows: { role: 'user' | 'assistant' | 'tool'; content: Prisma.JsonValue }[],
): LLMMessage[] {
  return rows.flatMap((m): LLMMessage[] => {
    if (m.role === 'tool') return [];
    const c = storedContent.parse(m.content ?? {});
    const charts = c.charts.map((ch) => `[Gráfica: ${ch.title}]`).join('\n');
    const text = [c.text, charts].filter(Boolean).join('\n\n');
    return text ? [{ role: m.role, content: text }] : [];
  });
}

export function aiRouter(
  db: PrismaClient,
  ai: AiConfig,
  jobs: JobEnqueuer,
  now: () => Date,
  logger: Logger,
): Router {
  const router = Router();
  router.use(requirePermission('ai:use'));
  const tools = toolDefinitions(ASSISTANT_TOOLS);

  router.get('/conversations', async (req, res) => {
    const auth = companyAuthOf(req);
    const page = conversationsQuery.parse(req.query);
    const where = { userId: auth.userId };
    const { rows, total, budget } = await withTenant(db, auth.companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId } });
      return {
        rows: await tx.aiConversation.findMany({
          where,
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(page),
        }),
        total: await tx.aiConversation.count({ where }),
        budget: await budgetStatus(tx, company, now()),
      };
    });
    respond(res, conversationsResponse, {
      ...paginated(
        rows.map((c) => ({
          id: c.id,
          title: c.title,
          last_message_at: c.lastMessageAt,
          created_at: c.createdAt,
        })),
        page,
        total,
      ),
      budget: { used_ratio: Math.round(budget.ratio * 1000) / 1000, exhausted: budget.exhausted },
    });
  });

  router.get('/conversations/:id', async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const found = await withTenant(db, auth.companyId, (tx) =>
      tx.aiConversation.findFirst({
        where: { id, userId: auth.userId },
        include: {
          messages: {
            where: { role: { in: ['user', 'assistant'] } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    );
    if (!found) throw conversationNotFound();
    respond(res, conversationDetail, {
      id: found.id,
      title: found.title,
      last_message_at: found.lastMessageAt,
      created_at: found.createdAt,
      messages: found.messages.map((m) => {
        const c = storedContent.parse(m.content ?? {});
        return {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text: c.text,
          charts: c.charts,
          plants: c.plants,
          created_at: m.createdAt,
        };
      }),
    });
  });

  router.delete('/conversations/:id', async (req, res) => {
    const auth = companyAuthOf(req);
    const { id } = idParam.parse(req.params);
    const deleted = await withTenant(db, auth.companyId, (tx) =>
      tx.aiConversation.deleteMany({ where: { id, userId: auth.userId } }),
    );
    if (deleted.count === 0) throw conversationNotFound();
    res.status(204).end();
  });

  router.post('/chat', async (req, res) => {
    const auth = companyAuthOf(req);
    const body = chatBody.parse(req.body);
    const started = Date.now();

    // 1. Validaciones antes de abrir el stream (responden como cualquier error de la API).
    const setup = await withTenant(db, auth.companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId } });
      const sent = await tx.aiMessage.count({
        where: {
          role: 'user',
          createdAt: { gte: new Date(now().getTime() - HOUR_MS) },
          conversation: { userId: auth.userId },
        },
      });
      if (sent >= CHAT_MESSAGES_PER_HOUR) {
        throw new HttpError(
          429,
          'CHAT_RATE_LIMIT',
          `Máximo ${CHAT_MESSAGES_PER_HOUR} mensajes por hora. Intenta más tarde.`,
        );
      }
      if ((await budgetStatus(tx, company, now())).exhausted) {
        throw new HttpError(
          429,
          'AI_BUDGET_EXHAUSTED',
          'Se agotó el presupuesto de IA de este mes; el asistente vuelve el próximo mes.',
        );
      }
      const conversation = body.conversation_id
        ? await tx.aiConversation.findFirst({
            where: { id: body.conversation_id, userId: auth.userId },
          })
        : await tx.aiConversation.create({
            data: {
              companyId: auth.companyId,
              userId: auth.userId,
              title: body.message.replace(/\s+/g, ' ').slice(0, TITLE_CHARS),
            },
          });
      if (!conversation) throw conversationNotFound();
      const previous = await tx.aiMessage.findMany({
        where: { conversationId: conversation.id, role: { in: ['user', 'assistant'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_MESSAGES,
        select: { role: true, content: true },
      });
      await tx.aiMessage.create({
        data: {
          companyId: auth.companyId,
          conversationId: conversation.id,
          role: 'user',
          content: { text: body.message },
        },
      });
      return { company, conversation, history: historyMessages(previous.reverse()) };
    });
    const { company, conversation } = setup;

    // 2. Stream.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    sse(res, 'message_start', { conversation_id: conversation.id });

    const today = localDate(now(), company.timezone);
    try {
      const turn = await runChatTurn({
        provider: ai.provider,
        model: ai.chatModel,
        system: chatSystemPrompt(company, today, company.timezone),
        tools,
        history: setup.history,
        message: body.message,
        // Cada herramienta corre en la empresa de la sesión (RLS); nunca con un id del modelo.
        runTool: (name, input) =>
          withTenant(db, auth.companyId, (tx) =>
            runTool(name, input, { tx, timezone: company.timezone, today, now: now() }),
          ),
        emit: (e: ChatEvent) => {
          if (e.type === 'text_delta') sse(res, 'text_delta', { text: e.text });
          else if (e.type === 'tool_status')
            sse(res, 'tool_status', { tool: e.tool, label: e.label });
          else sse(res, 'chart', e.chart);
        },
      });

      // 3. Guardar llamadas, respuesta y uso.
      const input = turn.usage.reduce((s, u) => s + totalInputTokens(u), 0);
      const output = turn.usage.reduce((s, u) => s + u.outputTokens, 0);
      const { messageId, emails } = await withTenant(db, auth.companyId, async (tx) => {
        for (const call of turn.toolCalls) {
          await tx.aiMessage.create({
            data: {
              companyId: auth.companyId,
              conversationId: conversation.id,
              role: 'tool',
              content: {},
              toolName: call.name,
              toolInput: (call.input ?? {}) as Prisma.InputJsonValue,
              toolOutputSummary: call.summary as Prisma.InputJsonObject,
            },
          });
        }
        const message = await tx.aiMessage.create({
          data: {
            companyId: auth.companyId,
            conversationId: conversation.id,
            role: 'assistant',
            content: {
              text: turn.text,
              charts: turn.charts,
              plants: turn.plants,
            } as unknown as Prisma.InputJsonObject,
            model: turn.model,
            inputTokens: input,
            outputTokens: output,
            latencyMs: Date.now() - started,
          },
        });
        await tx.aiConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now() },
        });
        const ids: string[] = [];
        for (const u of turn.usage) {
          const after = await recordUsage(tx, company, 'chat', u, now());
          if (after.crossedWarning) ids.push(...(await queueBudgetWarning(tx, company, after)));
        }
        return { messageId: message.id, emails: ids };
      });
      for (const id of emails) {
        await jobs
          .enqueue(notificationsSend, { company_id: auth.companyId, notification_id: id })
          .catch((err: Error) =>
            logger.error({ error_type: err.name }, 'no se pudo encolar el aviso'),
          );
      }
      sse(res, 'message_end', {
        message_id: messageId,
        conversation_id: conversation.id,
        plants: turn.plants,
        usage: { input_tokens: input, output_tokens: output },
      });
    } catch (err) {
      // El detalle va al log, no al usuario.
      logger.error({ error_type: (err as Error).name }, 'falló el chat del asistente');
      sse(res, 'error', {
        message: 'No se pudo completar la respuesta. Intenta de nuevo en un momento.',
      });
    } finally {
      res.end();
    }
  });

  return router;
}

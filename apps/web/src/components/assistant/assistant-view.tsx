'use client';

import { MessageSquarePlus, PanelLeft, Send, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Button, Notice, Spinner } from '@/components/ui';
import { ApiError, noContent } from '@/lib/api';
import {
  chartSpecSchema,
  conversationDetail,
  conversationsResponse,
  MAX_MESSAGE,
  readSse,
  SUGGESTED_QUESTIONS,
  type ChatMessage as Message,
  type PlantRef,
} from '@/lib/assistant';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatPct } from '@/lib/format';
import { useApiQuery } from '@/lib/use-api';
import { ChatMessage } from './chat-message';

// Asistente analítico (specs/09 §Asistente IA): conversaciones a la izquierda (cajón en el
// celular) y chat a la derecha, con la respuesta en streaming.

let localId = 0;
const nextId = () => `local-${++localId}`;

export function AssistantView() {
  const { api, authFetch, state } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const timezone = useCompanyTimezone();
  const conversations = useApiQuery('/ai/conversations?page_size=50', conversationsResponse);
  const [activeId, setActiveId] = useState<string | null>(params.get('c'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const budget = conversations.data?.budget;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'company_admin';
  const { reload: reloadConversations } = conversations;

  const open = useCallback(
    async (id: string) => {
      setDrawer(false);
      setError(null);
      setActiveId(id);
      setLoadingChat(true);
      try {
        const detail = await api(`/ai/conversations/${id}`, conversationDetail);
        setMessages(detail.messages.map((m) => ({ ...m })));
      } catch (err) {
        setError(errorMessage(err));
        setMessages([]);
      } finally {
        setLoadingChat(false);
      }
    },
    [api],
  );

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setDrawer(false);
  };

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sending) return;
      setSending(true);
      setError(null);
      setInput('');
      const answerId = nextId();
      const patch = (fn: (m: Message) => Message) =>
        setMessages((all) => all.map((m) => (m.id === answerId ? fn(m) : m)));
      setMessages((all) => [
        ...all,
        { id: nextId(), role: 'user', text: question, charts: [], plants: [] },
        { id: answerId, role: 'assistant', text: '', charts: [], plants: [], streaming: true },
      ]);
      try {
        const res = await authFetch('/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            message: question,
            ...(activeId && { conversation_id: activeId }),
          }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          throw new ApiError(
            res.status,
            body?.error?.code ?? 'HTTP_ERROR',
            body?.error?.message ?? 'No se pudo enviar tu pregunta.',
          );
        }
        await readSse(res.body, ({ event, data }) => {
          const d = data as Record<string, unknown>;
          if (event === 'message_start' && typeof d.conversation_id === 'string') {
            setActiveId(d.conversation_id);
          } else if (event === 'text_delta' && typeof d.text === 'string') {
            const chunk = d.text;
            patch((m) => ({ ...m, text: m.text + chunk, status: null }));
          } else if (event === 'tool_status' && typeof d.label === 'string') {
            const label = d.label;
            patch((m) => ({ ...m, status: label }));
          } else if (event === 'chart') {
            const chart = chartSpecSchema.safeParse(d);
            if (chart.success) patch((m) => ({ ...m, charts: [...m.charts, chart.data] }));
          } else if (event === 'message_end') {
            const plants = Array.isArray(d.plants) ? (d.plants as PlantRef[]) : [];
            patch((m) => ({ ...m, plants, streaming: false, status: null }));
          } else if (event === 'error') {
            const msg = typeof d.message === 'string' ? d.message : 'Ocurrió un error.';
            patch((m) => ({ ...m, streaming: false, status: null, error: msg }));
          }
        });
        patch((m) => ({ ...m, streaming: false, status: null }));
        void reloadConversations();
      } catch (err) {
        patch((m) => ({ ...m, streaming: false, status: null, error: errorMessage(err) }));
      } finally {
        setSending(false);
      }
    },
    [activeId, authFetch, reloadConversations, sending],
  );

  // Abrir una conversación (?c=) o hacer la pregunta que llega del tablero (?q=), una vez.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const c = params.get('c');
    const q = params.get('q');
    if (c) void open(c);
    else if (q) {
      router.replace('/assistant');
      void send(q);
    }
  }, [open, params, router, send]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  async function remove() {
    if (!activeId) return;
    try {
      await api(`/ai/conversations/${activeId}`, noContent, { method: 'DELETE' });
      startNew();
      void reloadConversations();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  const list = (
    <nav aria-label="Conversaciones" className="flex min-h-0 flex-1 flex-col gap-2">
      <Button type="button" variant="secondary" onClick={startNew}>
        <MessageSquarePlus aria-hidden="true" className="size-4" /> Nueva conversación
      </Button>
      {conversations.error ? (
        <Notice tone="error">{conversations.error.message}</Notice>
      ) : !conversations.data ? (
        <Spinner />
      ) : conversations.data.data.length === 0 ? (
        <p className="px-1 text-sm text-slate-600 dark:text-slate-400">
          Aún no tienes conversaciones.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {conversations.data.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void open(c.id)}
                aria-current={c.id === activeId ? 'true' : undefined}
                className={`flex min-h-11 w-full flex-col rounded-lg px-3 py-2 text-left text-sm ${c.id === activeId ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <span className="line-clamp-2 break-words">{c.title ?? 'Sin título'}</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {formatDateTime(c.last_message_at, timezone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && budget && (
        <p className="border-t border-slate-200 px-1 pt-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
          Uso de IA del mes: {formatPct(budget.used_ratio, 0)} del presupuesto
        </p>
      )}
    </nav>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-6xl gap-4 md:h-[calc(100dvh-4rem)]">
      <aside className="hidden w-64 shrink-0 flex-col gap-3 md:flex">{list}</aside>
      {drawer && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Conversaciones"
        >
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-3 bg-white p-4 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Conversaciones</span>
              <button
                type="button"
                aria-label="Cerrar conversaciones"
                onClick={() => setDrawer(false)}
                className="flex size-11 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            {list}
          </div>
        </div>
      )}

      <section aria-label="Chat" className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 md:hidden dark:border-slate-600"
              aria-label="Ver conversaciones"
            >
              <PanelLeft aria-hidden="true" className="size-5" />
            </button>
            <h1 className="truncate text-xl font-semibold">Asistente IA</h1>
          </div>
          {activeId && !sending && (
            <ConfirmButton
              label="Borrar"
              confirmLabel="Sí, borrar"
              question="¿Borrar esta conversación?"
              onConfirm={() => void remove()}
            />
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {loadingChat ? (
            <Spinner />
          ) : messages.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-base">
                Pregunta sobre tus plantas: rendimiento, lavados, alertas, zonas o tickets. Respondo
                con los datos de tu empresa.
              </p>
              <ul className="flex flex-col gap-2" aria-label="Preguntas sugeridas">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      disabled={sending || budget?.exhausted}
                      onClick={() => void send(q)}
                      className="min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="flex flex-col gap-5" aria-live="polite">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} />
              ))}
            </ol>
          )}
          <div ref={endRef} />
        </div>

        {budget?.exhausted ? (
          <Notice tone="info">
            Se agotó el presupuesto de IA de este mes; el asistente vuelve el próximo mes.
          </Notice>
        ) : (
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <label htmlFor="pregunta" className="sr-only">
              Tu pregunta
            </label>
            <textarea
              id="pregunta"
              rows={2}
              value={input}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Escribe tu pregunta…"
              className="min-h-11 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-900"
            />
            <Button type="submit" disabled={sending || !input.trim()} aria-label="Enviar">
              <Send aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Enviar</span>
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

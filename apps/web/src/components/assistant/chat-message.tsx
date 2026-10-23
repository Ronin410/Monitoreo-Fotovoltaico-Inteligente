'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkPlants, type ChatMessage as Message } from '@/lib/assistant';
import { ChatChart } from './chat-chart';

// Un mensaje del chat. El texto del asistente es markdown (sin HTML); solo se enlazan las plantas
// que vinieron en los datos, nunca direcciones externas.

const PLANT_LINK = /^\/plants\/[0-9a-f-]{36}$/;

const components: Components = {
  a: ({ href, children }) =>
    href && PLANT_LINK.test(href) ? (
      <Link href={href} className="font-medium text-brand-text underline">
        {children}
      </Link>
    ) : (
      <span>{children}</span>
    ),
  img: () => null,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 dark:bg-slate-800/60">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-t border-slate-100 dark:border-slate-800">{children}</tr>
  ),
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  h1: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em] dark:bg-slate-800">
      {children}
    </code>
  ),
};

export function ChatMessage({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-base whitespace-pre-wrap text-on-brand">
          {message.text}
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <Sparkles className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {message.text && (
          <div className="text-base break-words text-slate-900 dark:text-slate-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
              {linkPlants(message.text, message.plants)}
            </ReactMarkdown>
          </div>
        )}
        {message.charts.map((c, i) => (
          <ChatChart key={`${c.title}-${i}`} chart={c} />
        ))}
        {message.streaming && (
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
          >
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand"
            />
            {message.status ?? 'Pensando…'}
          </div>
        )}
        {message.error && (
          <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
            {message.error}
          </p>
        )}
      </div>
    </li>
  );
}

'use client';

import { CircleCheck, Clock, FileText, Mail, OctagonAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Filter } from '@/components/filter';
import { PageHeader } from '@/components/page-header';
import { Button, Notice, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  canSend,
  closedPeriods,
  generateResponse,
  periodLabel,
  reportsListSchema,
  rowState,
  sendAllResponse,
  sendResponse,
  type ReportItem,
  type RowState,
} from '@/lib/reports';
import { useApiQuery } from '@/lib/use-api';

// Reportes (specs/09 §Reportes, specs/08 §1): selector de mes, clientes con el estado de su
// reporte, vista previa del PDF, regenerar, enviar uno y enviar todos.

const POLL_MS = 4000;

const STATE: Record<RowState, { label: string; icon: typeof Clock; badge: string }> = {
  none: {
    label: 'Sin generar',
    icon: FileText,
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  pending: {
    label: 'Generando…',
    icon: Clock,
    badge: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  },
  generated: {
    label: 'Generado',
    icon: FileText,
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  },
  sent: {
    label: 'Enviado',
    icon: CircleCheck,
    badge: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  },
  failed: {
    label: 'Error al generar',
    icon: OctagonAlert,
    badge: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
};

function StateBadge({ state }: { state: RowState }) {
  const s = STATE[state];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.badge}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {s.label}
    </span>
  );
}

const thisMonth = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);

/** Vista previa del PDF (blob local: la descarga necesita el token de la sesión). */
function PdfPreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-2 sm:p-6"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            <a
              href={url}
              download={`${title}.pdf`}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-brand-text hover:underline"
            >
              Descargar
            </a>
            <Button type="button" variant="ghost" onClick={onClose} aria-label="Cerrar" autoFocus>
              <X aria-hidden="true" className="size-5" />
            </Button>
          </div>
        </div>
        <iframe src={url} title={title} className="min-h-0 flex-1 bg-slate-100" />
      </div>
    </div>
  );
}

export function ReportsView() {
  const { api, authFetch } = useAuth();
  const timezone = useCompanyTimezone();
  const periods = closedPeriods(thisMonth(timezone));
  const [period, setPeriod] = useState(periods[0] ?? '');
  const { data, error, loading, reload } = useApiQuery(
    `/reports?period=${period}`,
    reportsListSchema,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  // Mientras se genera o se envía algo, la lista se actualiza sola.
  const sentNow = new Set(
    data?.items.flatMap((i) => (i.report?.status === 'sent' ? [i.report.id] : [])),
  );
  const waiting =
    data?.items.some((i) => i.report?.status === 'pending') ||
    [...sending].some((id) => !sentNow.has(id));
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => void reload(), POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, data, reload]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'success', text: await action() });
      await reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const generate = (clientIds?: string[]) =>
    run(clientIds ? `gen:${clientIds[0]}` : 'gen:all', async () => {
      const res = await api('/reports/generate', generateResponse, {
        method: 'POST',
        body: { period, ...(clientIds && { client_ids: clientIds }) },
      });
      return res.queued === 1
        ? 'Generando el reporte. Tarda unos segundos.'
        : `Generando ${res.queued} reportes.${res.skipped_sent ? ` ${res.skipped_sent} ya enviados no se regeneran.` : ''}`;
    });

  const send = (item: ReportItem, reportId: string) =>
    run(`send:${reportId}`, async () => {
      await api(`/reports/${reportId}/send`, sendResponse, { method: 'POST' });
      setSending((s) => new Set(s).add(reportId));
      return `Enviando el reporte a ${item.client.report_email}.`;
    });

  const sendAll = () =>
    run('send:all', async () => {
      const res = await api('/reports/send-all', sendAllResponse, {
        method: 'POST',
        body: { period },
      });
      const ready = data?.items.flatMap((i) => (canSend(i) && i.report ? [i.report.id] : [])) ?? [];
      setSending((s) => new Set([...s, ...ready]));
      return `Enviando ${res.queued} ${res.queued === 1 ? 'reporte' : 'reportes'}.${res.without_email ? ` ${res.without_email} sin correo para reportes.` : ''}`;
    });

  async function openPdf(item: ReportItem, reportId: string) {
    setBusy(`pdf:${reportId}`);
    setMessage(null);
    try {
      const res = await authFetch(`/reports/${reportId}/pdf`, { method: 'GET' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        throw new ApiError(
          res.status,
          body?.error?.code ?? 'HTTP_ERROR',
          body?.error?.message ?? 'No se pudo abrir el PDF.',
        );
      }
      const url = URL.createObjectURL(await res.blob());
      setPreview({ url, title: `Reporte ${periodLabel(period)} — ${item.client.name}` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const readyToSend = data?.items.filter(canSend).length ?? 0;
  const generable = data?.items.filter((i) => i.plants > 0 && rowState(i) !== 'sent').length ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Reportes"
        subtitle="Reporte mensual en PDF para cada cliente, con la marca de su empresa."
        actions={
          data?.can_generate && (
            <>
              {generable > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void generate()}
                >
                  {busy === 'gen:all' ? 'Generando…' : 'Generar todos'}
                </Button>
              )}
              {readyToSend > 0 && (
                <ConfirmButton
                  label={`Enviar todos (${readyToSend})`}
                  confirmLabel="Sí, enviar"
                  question={`¿Enviar ${readyToSend} ${readyToSend === 1 ? 'reporte' : 'reportes'} por correo a sus clientes?`}
                  busy={busy === 'send:all'}
                  onConfirm={() => void sendAll()}
                />
              )}
            </>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <Filter
          id="period"
          label="Mes"
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setMessage(null);
          }}
          options={periods.map((p) => ({ value: p, label: periodLabel(p) }))}
        />
        {data?.auto_send && (
          <p className="flex-1 text-sm text-slate-600 dark:text-slate-400">
            Envío automático activo: los reportes del día 1 se envían solos al generarse.
          </p>
        )}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.items.length === 0 ? (
        <Notice tone="info">
          Ningún cliente tuvo plantas activas en {periodLabel(data.period)}.
        </Notice>
      ) : data ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {data.items.map((item) => {
            const r = item.report;
            const state = rowState(item);
            const isSending = r !== null && sending.has(r.id) && state !== 'sent';
            return (
              <li
                key={item.client.id}
                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-words">{item.client.name}</span>
                    <StateBadge state={state} />
                    {r?.status === 'generated' && r.narrative_source === 'template' && (
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        texto de plantilla
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                    <span>{item.plants === 1 ? '1 planta' : `${item.plants} plantas`}</span>
                    {r?.status === 'sent' && r.sent_at ? (
                      <span>
                        Enviado a {r.sent_to} el {formatDateTime(r.sent_at, timezone)}
                      </span>
                    ) : item.client.report_email ? (
                      <span className="inline-flex items-center gap-1">
                        <Mail aria-hidden="true" className="size-3.5" />
                        {item.client.report_email}
                      </span>
                    ) : (
                      <span className="text-amber-800 dark:text-amber-300">
                        Sin correo para reportes (agréguelo en Clientes)
                      </span>
                    )}
                    {isSending && <span>Enviando…</span>}
                    {r?.send_failed && !isSending && (
                      <span className="text-red-700 dark:text-red-300">
                        El último envío falló; inténtelo de nuevo.
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r?.has_pdf && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void openPdf(item, r.id)}
                    >
                      {busy === `pdf:${r.id}` ? 'Abriendo…' : 'Ver PDF'}
                    </Button>
                  )}
                  {data.can_generate && item.plants > 0 && state !== 'sent' && (
                    <Button
                      type="button"
                      variant={state === 'none' ? 'secondary' : 'ghost'}
                      disabled={busy !== null || state === 'pending'}
                      onClick={() => void generate([item.client.id])}
                    >
                      {busy === `gen:${item.client.id}`
                        ? 'Generando…'
                        : state === 'none'
                          ? 'Generar'
                          : 'Regenerar'}
                    </Button>
                  )}
                  {r && canSend(item) && (
                    <Button
                      type="button"
                      disabled={busy !== null || isSending}
                      onClick={() => void send(item, r.id)}
                    >
                      {busy === `send:${r.id}` ? 'Enviando…' : 'Enviar'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {preview && (
        <PdfPreview url={preview.url} title={preview.title} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

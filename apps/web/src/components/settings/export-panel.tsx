'use client';

import { Download, FileArchive } from 'lucide-react';
import { useState } from 'react';
import { Button, Notice, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  companyExportsSchema,
  exportQueued,
  formatBytes,
  type CompanyExport,
} from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Exportar todos los datos de la empresa (docs/plan-lanzamiento.md 3.7): un ZIP con un archivo
// CSV por tabla, que se abre en Excel. Se prepara en segundo plano y se descarga unos días.

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

const STATUS: Record<CompanyExport['status'], string> = {
  running: 'Preparando…',
  succeeded: 'Lista',
  failed: 'Falló',
  skipped: 'Omitida',
};

export function ExportPanel() {
  const { api, authFetch } = useAuth();
  const timezone = useCompanyTimezone();
  const { data, error, reload } = useApiQuery('/company/exports', companyExportsSchema);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function request() {
    setBusy('request');
    setMessage(null);
    try {
      await api('/company/exports', exportQueued, { method: 'POST' });
      setMessage({
        tone: 'success',
        text: 'Estamos preparando el archivo. Tarda unos minutos; vuelva a esta pestaña y presione "Actualizar".',
      });
      await reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function download(item: CompanyExport) {
    setBusy(item.id);
    setMessage(null);
    try {
      const res = await authFetch(`/company/exports/${item.id}/download`, { method: 'GET' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        throw new ApiError(
          res.status,
          body?.error?.code ?? 'HTTP_ERROR',
          body?.error?.message ?? 'No se pudo descargar el archivo.',
        );
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
        'pv-iot-exportacion.zip';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      // Revocarlo en el acto cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
      // Una exportación nueva reemplaza a la anterior: se refresca la lista.
      if (err instanceof ApiError && err.status === 404) await reload();
    } finally {
      setBusy(null);
    }
  }

  const running = data?.data.some((e) => e.status === 'running') ?? false;

  return (
    <section className={card} aria-labelledby="export-title">
      <h2 id="export-title" className="text-base font-semibold">
        Exportar los datos de la empresa
      </h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Un archivo ZIP con todos sus datos en hojas CSV que se abren en Excel: clientes, plantas,
        lecturas, métricas diarias, alertas, tickets, reportes, usuarios y auditoría. No incluye
        contraseñas ni las credenciales de los portales de inversores. Úselo para tener un respaldo
        propio, atender una solicitud de un cliente o al terminar el servicio.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy !== null || running} onClick={() => void request()}>
          <FileArchive aria-hidden="true" className="size-4" />
          {running ? 'Preparando…' : 'Preparar exportación'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          Actualizar
        </Button>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : !data ? (
        <Spinner />
      ) : data.data.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Aún no hay exportaciones.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex flex-col text-sm">
                <span className="font-medium">
                  {formatDateTime(e.requested_at, timezone)} · {STATUS[e.status]}
                  {e.size_bytes !== null && ` · ${formatBytes(e.size_bytes)}`}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {e.available_until
                    ? `Disponible hasta el ${formatDateTime(e.available_until, timezone)}`
                    : e.status === 'succeeded'
                      ? 'Ya no está disponible; prepare una nueva.'
                      : e.status === 'failed'
                        ? 'Vuelva a intentarlo; si se repite, avise a soporte.'
                        : ''}
                </span>
              </div>
              {e.available_until && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void download(e)}
                >
                  <Download aria-hidden="true" className="size-4" />
                  {busy === e.id ? 'Descargando…' : 'Descargar'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

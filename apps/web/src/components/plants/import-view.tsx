'use client';

import { Download, FileUp } from 'lucide-react';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  IMPORT_GUIDE,
  importResult,
  readCsvFile,
  TEMPLATE_URL,
  type ImportResult,
} from '@/lib/import';

// Importación masiva de clientes y plantas desde un CSV de Excel (docs/plan-lanzamiento.md 6.4):
// primero se revisa (no guarda nada) y, si no hay errores, se importa todo junto.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Summary({ result }: { result: ImportResult }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ['Renglones', result.rows],
        ['Clientes nuevos', result.clients_new],
        ['Clientes que ya existían', result.clients_existing],
        ['Plantas', result.plants_new],
      ].map(([label, value]) => (
        <li
          key={label}
          className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <span className="block text-xs text-slate-600 dark:text-slate-400">{label}</span>
          <span className="text-xl font-semibold tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  );
}

export function ImportView() {
  const { api } = useAuth();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResult(null);
    setError(null);
    setFile(f ? { name: f.name, text: await readCsvFile(f) } : null);
  }

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api(`/plants/import${dryRun ? '?dry_run=true' : ''}`, importResult, {
          method: 'POST',
          body: new Blob([file.text], { type: 'text/csv' }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = result && !result.imported && result.errors.length === 0 && result.plants_new > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Importar plantas desde Excel"
        subtitle="Dé de alta muchos clientes y plantas a la vez con un archivo CSV."
        back={{ href: '/plants', label: 'Plantas' }}
      />

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">1. Prepare el archivo</h2>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Descargue la plantilla y ábrala en Excel. Cada renglón es una planta con los datos de su
          cliente; si un cliente tiene varias plantas, repita su nombre. Al terminar, guárdela como{' '}
          <strong>CSV UTF-8 (delimitado por comas)</strong>.
        </p>
        <a
          href={TEMPLATE_URL}
          download
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <Download aria-hidden="true" className="size-4" /> Descargar plantilla
        </a>
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-brand-text">
            Qué va en cada columna
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-600 uppercase dark:text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Columna
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Obligatoria
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Qué poner
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {IMPORT_GUIDE.map((g) => (
                  <tr key={g.column}>
                    <td className="py-2 pr-3 font-mono text-xs break-words">{g.column}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{g.required}</td>
                    <td className="py-2">{g.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">2. Revise e importe</h2>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Archivo CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e)}
            className="text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-4 file:font-semibold dark:file:border-slate-600 dark:file:bg-slate-900"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!file || busy} onClick={() => void send(true)}>
            <FileUp aria-hidden="true" className="size-4" />
            {busy ? 'Revisando…' : 'Revisar archivo'}
          </Button>
          {ready && (
            <ConfirmButton
              label={`Importar ${plural(result.plants_new, 'planta', 'plantas')}`}
              confirmLabel="Sí, importar"
              question={`¿Crear ${plural(result.clients_new, 'cliente nuevo', 'clientes nuevos')} y ${plural(result.plants_new, 'planta', 'plantas')}?`}
              busy={busy}
              onConfirm={() => void send(false)}
            />
          )}
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <>
            {result.imported ? (
              <Notice tone="success">
                Se importaron {plural(result.plants_new, 'planta', 'plantas')} y{' '}
                {plural(result.clients_new, 'cliente nuevo', 'clientes nuevos')}. La plataforma
                descarga su clima de los últimos 90 días en unos minutos.{' '}
                <Link href="/plants" className="font-semibold underline">
                  Ver plantas
                </Link>
              </Notice>
            ) : result.errors.length === 0 ? (
              <Notice tone="info">
                El archivo está listo: revise el resumen y presione &quot;Importar&quot;. Aún no se
                guardó nada.
              </Notice>
            ) : (
              <Notice tone="error">
                Hay {plural(result.errors.length, 'problema', 'problemas')}.{' '}
                {result.errors.length === 1 ? 'Corríjalo' : 'Corríjalos'} en Excel y vuelva a
                revisar el archivo; no se guardó nada.
              </Notice>
            )}
            <Summary result={result} />
            {result.ignored_columns.length > 0 && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Columnas que no se usan y se ignoraron: {result.ignored_columns.join(', ')}.
              </p>
            )}
            {result.errors.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Problemas del archivo</caption>
                  <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase dark:border-slate-800 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Renglón
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Columna
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Problema
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 tabular-nums">{e.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.column ?? '—'}</td>
                        <td className="px-3 py-2">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

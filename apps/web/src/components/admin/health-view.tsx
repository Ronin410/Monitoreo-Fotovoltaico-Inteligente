'use client';

import { CircleCheck, Clock, OctagonAlert, SkipForward, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button, Notice, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { healthSchema, type JobStatus } from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Salud del sistema (specs/09 §Superadmin): última ejecución de cada job y errores recientes.

/** Qué hace cada job, para quien no conoce el worker. */
const JOB_LABELS: Record<string, string> = {
  'ingest.weather': 'Clima (todas las empresas)',
  'ingest.weather_company': 'Clima de una empresa',
  'weather.backfill': 'Clima histórico',
  'ingest.telemetry': 'Lecturas de inversores (todas)',
  'ingest.telemetry_plant': 'Lecturas de una planta',
  'metrics.daily': 'Cálculo diario (todas)',
  'metrics.daily_company': 'Cálculo diario de una empresa',
  'metrics.recompute': 'Recálculo de métricas',
  'alerts.evaluate': 'Evaluación de alertas',
  'alerts.offline': 'Plantas sin datos (todas)',
  'alerts.offline_company': 'Plantas sin datos de una empresa',
  'notifications.send': 'Envío de correos',
  'notifications.daily_summary': 'Resumen diario (todas)',
  'notifications.daily_summary_company': 'Resumen diario de una empresa',
};

const STATUS: Record<JobStatus, { label: string; icon: LucideIcon; style: string }> = {
  succeeded: {
    label: 'Correcto',
    icon: CircleCheck,
    style: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  },
  failed: {
    label: 'Falló',
    icon: OctagonAlert,
    style: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
  running: {
    label: 'En curso',
    icon: Clock,
    style: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  },
  skipped: {
    label: 'Omitido',
    icon: SkipForward,
    style: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

function JobBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.style}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {s.label}
    </span>
  );
}

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const card =
  'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

export function HealthView() {
  const { data, error, loading, reload } = useApiQuery('/admin/health', healthSchema);
  const tz = browserTz();
  const when = (iso: string | null) => (iso ? formatDateTime(iso, tz) : '—');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title="Salud del sistema"
        subtitle={
          data ? `Actualizado ${when(data.generated_at)} (hora de tu navegador)` : undefined
        }
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void reload()}
          >
            Actualizar
          </Button>
        }
      />
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : !data ? (
        <Spinner />
      ) : (
        <>
          <section className={card} aria-labelledby="jobs-title">
            <h2 id="jobs-title" className="text-base font-semibold">
              Jobs
            </h2>
            {data.jobs.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Aún no se ha ejecutado ningún job.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                <li
                  aria-hidden="true"
                  className="hidden grid-cols-[2fr_1fr_1.5fr_1.5fr_1fr] gap-3 pb-2 text-xs font-semibold text-slate-600 md:grid dark:text-slate-400"
                >
                  <span>Job</span>
                  <span>Última ejecución</span>
                  <span>Inicio</span>
                  <span>Último éxito</span>
                  <span>Fallas</span>
                </li>
                {data.jobs.map((j) => (
                  <li
                    key={j.job_name}
                    className="grid grid-cols-1 gap-1 py-3 text-sm md:grid-cols-[2fr_1fr_1.5fr_1.5fr_1fr] md:items-center md:gap-3"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{JOB_LABELS[j.job_name] ?? j.job_name}</span>
                      <code className="text-xs text-slate-500 dark:text-slate-400">
                        {j.job_name}
                      </code>
                    </span>
                    <span>
                      <JobBadge status={j.last_status} />
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      <span className="text-xs text-slate-500 md:hidden">Inicio: </span>
                      {when(j.last_started_at)}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      <span className="text-xs text-slate-500 md:hidden">Último éxito: </span>
                      {when(j.last_success_at)}
                    </span>
                    <span
                      className={
                        j.failures_24h > 0 ? 'font-semibold text-red-700 dark:text-red-400' : ''
                      }
                    >
                      {j.failures_24h} {j.failures_24h === 1 ? 'falla' : 'fallas'} en 24 h
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={card} aria-labelledby="failures-title">
            <h2 id="failures-title" className="text-base font-semibold">
              Errores recientes
            </h2>
            {data.recent_failures.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Sin errores registrados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                {data.recent_failures.map((f, i) => (
                  <li
                    key={`${f.job_name}-${f.started_at}-${i}`}
                    className="flex flex-col gap-1 py-3 text-sm"
                  >
                    <span className="font-medium">
                      {JOB_LABELS[f.job_name] ?? f.job_name}
                      <span className="font-normal text-slate-600 dark:text-slate-400">
                        {' '}
                        · {f.company?.name ?? 'plataforma'} · {when(f.started_at)}
                      </span>
                    </span>
                    {f.error && (
                      <code className="rounded bg-slate-50 p-2 text-xs break-words whitespace-pre-wrap dark:bg-slate-800">
                        {f.error}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

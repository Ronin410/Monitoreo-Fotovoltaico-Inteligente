'use client';

import { can } from '@pv/core';
import { Check, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { fieldErrors, TextArea, type FieldErrors } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SeverityBadge } from '@/components/status';
import { AssignmentFields, assignmentBody } from '@/components/tickets/ticket-fields';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { ALERT_TYPE_LABELS } from '@/lib/dashboard';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  aiExplanationSchema,
  ALERT_STATUS_LABELS,
  alertDetail,
  evidenceSchema,
  ticketSchema,
  type AlertDetail as Alert,
} from '@/lib/operations';
import { useApiQuery } from '@/lib/use-api';
import { EvidenceChart } from './evidence-chart';

// Detalle de una alerta (specs/09 §Alertas): resumen IA, pérdida estimada, evidencia de los
// últimos 14 días y acciones (reconocer, crear ticket, descartar con motivo, regenerar).

const PRIORITY_BY_SEVERITY = { critical: 'high', warning: 'normal', info: 'low' } as const;
const CONFIDENCE = { baja: 'Baja', media: 'Media', alta: 'Alta' } as const;
const RESOLUTION = {
  auto: 'se resolvió sola al normalizarse',
  ticket: 'se resolvió con un ticket',
  manual: 'se resolvió a mano',
} as const;
const card =
  'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

function Explanation({ alert }: { alert: Alert }) {
  const parsed = aiExplanationSchema.safeParse(alert.ai_explanation);
  return (
    <section
      aria-labelledby="ai-title"
      className={`${card} border-l-4 border-l-brand dark:border-l-brand`}
    >
      <h2 id="ai-title" className="flex items-center gap-2 text-base font-semibold">
        <Sparkles aria-hidden="true" className="size-4" /> Resumen
      </h2>
      {parsed.success ? (
        <>
          <p className="text-base">{parsed.data.resumen}</p>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Causa probable</dt>
              <dd className="font-medium">{parsed.data.causa_probable}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Confianza</dt>
              <dd className="font-medium">{CONFIDENCE[parsed.data.confianza]}</dd>
            </div>
            {parsed.data.otras_causas.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Otras causas</dt>
                <dd>{parsed.data.otras_causas.join(' · ')}</dd>
              </div>
            )}
          </dl>
          {parsed.data.que_revisar.length > 0 && (
            <div className="text-sm">
              <h3 className="mb-1 text-xs text-slate-500 dark:text-slate-400">Qué revisar</h3>
              <ul className="list-disc pl-5">
                {parsed.data.que_revisar.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          La explicación automática aún no está disponible para esta alerta. Mientras tanto, la
          evidencia de abajo muestra qué la disparó.
        </p>
      )}
    </section>
  );
}

function Fact({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-xs text-slate-600 dark:text-slate-400">{detail}</span>}
    </div>
  );
}

function Facts({ alert, timezone }: { alert: Alert; timezone: string }) {
  const ev = evidenceSchema.safeParse(alert.evidence);
  const e = ev.success ? ev.data : null;
  const loss = alert.estimated_loss;
  const deviation = e?.trigger?.deviation_pct.at(-1);
  return (
    <section
      aria-label="Datos clave"
      className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
    >
      {alert.type === 'offline' ? (
        <>
          <Fact
            label="Última lectura"
            value={e?.last_reading_at ? formatDateTime(e.last_reading_at, timezone) : 'Nunca'}
          />
          {e?.sun_hours_without_data !== undefined && (
            <Fact
              label="Horas de sol sin datos"
              value={formatNumber(e.sun_hours_without_data, 1)}
            />
          )}
        </>
      ) : (
        <>
          {typeof deviation === 'number' && (
            <Fact
              label="Debajo de su normal"
              value={`${formatNumber(deviation, 1)} %`}
              detail={
                e?.baseline?.value
                  ? `Normal: PR ${formatNumber(e.baseline.value * 100, 1)} %`
                  : undefined
              }
            />
          )}
          {e?.trend?.days_since_reset !== null && e?.trend?.days_since_reset !== undefined && (
            <Fact
              label="Días desde el último lavado"
              value={e.trend.days_since_reset}
              detail={
                e.trend.last_reset?.type === 'rain_cleaning' ? 'Lavado por lluvia' : undefined
              }
            />
          )}
          {e?.neighbors?.neighbor_index !== null && e?.neighbors?.neighbor_index !== undefined && (
            <Fact
              label="Frente a sus vecinas"
              value={`${formatNumber(e.neighbors.neighbor_index * 100, 0)} %`}
              detail={`de lo que rinden ${e.neighbors.count ?? 0} plantas cercanas (100 % = igual)`}
            />
          )}
        </>
      )}
      <Fact
        label="Pérdida estimada"
        value={loss ? `${formatNumber(loss.kwh_per_day, 1)} kWh/día` : '—'}
        detail={
          loss
            ? `≈ $${formatNumber(loss.mxn_per_day, 0)} MXN por día (tarifa $${formatNumber(loss.tariff_mxn_per_kwh, 2)}/kWh)`
            : 'Sin datos suficientes para estimarla'
        }
      />
    </section>
  );
}

function TicketForm({
  alert,
  onDone,
  onCancel,
}: {
  alert: Alert;
  onDone: (ticketId: string) => void;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const ticket = await api(`/alerts/${alert.id}/ticket`, ticketSchema, {
        method: 'POST',
        body: assignmentBody(new FormData(e.currentTarget)),
      });
      onDone(ticket.id);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={card} aria-labelledby="ticket-form-title">
      <h2 id="ticket-form-title" className="text-base font-semibold">
        Crear ticket
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        El tipo, el título y la descripción se llenan con la alerta; después puedes editarlos.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AssignmentFields errors={errors} priorityDefault={PRIORITY_BY_SEVERITY[alert.severity]} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear ticket'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function DismissForm({
  alertId,
  onDone,
  onCancel,
}: {
  alertId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api(`/alerts/${alertId}/dismiss`, alertDetail, {
        method: 'POST',
        body: { reason: String(new FormData(e.currentTarget).get('reason') ?? '') },
      });
      onDone();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(Object.keys(fields).length ? fields : { reason: errorMessage(err) });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={card}>
      <TextArea
        id="reason"
        label="¿Por qué se descarta?"
        required
        maxLength={1000}
        error={errors.reason}
        hint="Queda registrado en la alerta; ayuda a ajustar los umbrales."
        autoFocus
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Descartando…' : 'Descartar alerta'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function AlertDetail({ id }: { id: string }) {
  const { api, state } = useAuth();
  const router = useRouter();
  const timezone = useCompanyTimezone();
  const alert = useApiQuery(`/alerts/${id}`, alertDetail);
  const [mode, setMode] = useState<'view' | 'ticket' | 'dismiss'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manage = state.status === 'authenticated' && can(state.user.role, 'alerts:manage');

  if (alert.error) {
    return (
      <Notice tone="error">
        {alert.error.status === 404 ? 'Esta alerta no existe.' : alert.error.message}
      </Notice>
    );
  }
  if (!alert.data) return <Spinner />;
  const a = alert.data;
  const isOpen = a.status === 'open' || a.status === 'acknowledged';

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await api(`/alerts/${id}/acknowledge`, alertDetail, { method: 'POST' });
      await alert.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={ALERT_TYPE_LABELS[a.type]}
        back={{ href: '/alerts', label: 'Alertas' }}
        subtitle={
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={a.severity} />
              <span className="font-semibold">{ALERT_STATUS_LABELS[a.status]}</span>
              <span>· detectada {formatDateTime(a.detected_at, timezone)}</span>
            </span>
            <span>
              <Link href={`/plants/${a.plant.id}`} className="text-brand-text hover:underline">
                {a.plant.name}
              </Link>{' '}
              · {a.plant.client_name} · {a.plant.colonia}
            </span>
          </span>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {a.status === 'dismissed' && (
        <Notice tone="info">Descartada: {a.dismiss_reason ?? 'sin motivo registrado'}.</Notice>
      )}
      {a.status === 'resolved' && a.resolved_at && (
        <Notice tone="success">
          Resuelta el {formatDateTime(a.resolved_at, timezone)}
          {a.resolution ? `: ${RESOLUTION[a.resolution]}` : ''}.
        </Notice>
      )}

      {manage && isOpen && mode === 'view' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Acciones">
          {a.status === 'open' && (
            <Button type="button" variant="secondary" disabled={busy} onClick={acknowledge}>
              <Check aria-hidden="true" className="size-4" /> Marcar como vista
            </Button>
          )}
          {a.ticket_id ? (
            <Link
              href={`/tickets/${a.ticket_id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              <Wrench aria-hidden="true" className="size-4" /> Ver ticket
            </Link>
          ) : (
            <Button type="button" onClick={() => setMode('ticket')}>
              <Wrench aria-hidden="true" className="size-4" /> Crear ticket
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setMode('dismiss')}>
            Descartar
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled
            title="Disponible cuando se active la explicación automática"
          >
            <RefreshCw aria-hidden="true" className="size-4" /> Regenerar explicación
          </Button>
        </div>
      )}
      {!isOpen && a.ticket_id && (
        <Link href={`/tickets/${a.ticket_id}`} className="text-sm text-brand-text hover:underline">
          Ver el ticket de esta alerta
        </Link>
      )}
      {mode === 'ticket' && (
        <TicketForm
          alert={a}
          onCancel={() => setMode('view')}
          onDone={(ticketId) => router.push(`/tickets/${ticketId}`)}
        />
      )}
      {mode === 'dismiss' && (
        <DismissForm
          alertId={id}
          onCancel={() => setMode('view')}
          onDone={() => {
            setMode('view');
            void alert.reload();
          }}
        />
      )}

      <Explanation alert={a} />
      <Facts alert={a} timezone={timezone} />
      <EvidenceChart evidence={a.evidence} />
    </div>
  );
}

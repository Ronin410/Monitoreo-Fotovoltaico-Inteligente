'use client';

import { LineChart, Pause, Pencil, Play } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { LinkButton, PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status';
import { Button, Notice, Spinner } from '@/components/ui';
import { noContent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime, formatEnergy, formatNumber, formatPct } from '@/lib/format';
import { BRAND_LABELS, LIFECYCLE_LABELS, plantSchema } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';
import { CredentialsPanel } from './credentials-panel';
import { EventsPanel } from './events-panel';

const CONFIDENCE = { low: 'baja', medium: 'media', high: 'alta' } as const;

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className="text-sm text-slate-600 dark:text-slate-400">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-xs text-slate-600 dark:text-slate-400">{detail}</span>}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  );
}

export function PlantDetail({ id }: { id: string }) {
  const { api, state } = useAuth();
  const router = useRouter();
  const plant = useApiQuery(`/plants/${id}`, plantSchema);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone =
    (state.status === 'authenticated' && state.company?.timezone) || 'America/Mazatlan';

  if (plant.error) {
    return (
      <Notice tone="error">
        {plant.error.status === 404
          ? 'Esta planta no existe o fue eliminada.'
          : plant.error.message}
      </Notice>
    );
  }
  if (!plant.data) return <Spinner />;
  const p = plant.data;
  const m = p.metrics;
  const today = m ? formatEnergy(m.energy_today_kwh) : null;

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const togglePause = () =>
    run(
      () =>
        api(`/plants/${id}`, plantSchema, {
          method: 'PATCH',
          body: { status: p.status === 'active' ? 'paused' : 'active' },
        }),
      () => void plant.reload(),
    );
  const remove = () =>
    run(
      () => api(`/plants/${id}`, noContent, { method: 'DELETE' }),
      () => router.push('/plants'),
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title={p.name}
        back={{ href: '/plants', label: 'Plantas' }}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/clients/${p.client.id}`} className="text-brand-text hover:underline">
              {p.client.name}
            </Link>
            <span>· {p.colonia}</span>
            <span>· {formatNumber(p.capacity_kwp, 1)} kWp</span>
            <span>
              · {BRAND_LABELS[p.inverter_brand]}
              {p.inverter_model ? ` ${p.inverter_model}` : ''}
            </span>
            {p.status !== 'active' && (
              <span className="font-semibold">· {LIFECYCLE_LABELS[p.status]}</span>
            )}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/plants/${id}/edit`} variant="secondary">
              <Pencil aria-hidden="true" className="size-4" /> Editar
            </LinkButton>
            {p.status !== 'decommissioned' && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void togglePause()}
              >
                {p.status === 'active' ? (
                  <>
                    <Pause aria-hidden="true" className="size-4" /> Pausar
                  </>
                ) : (
                  <>
                    <Play aria-hidden="true" className="size-4" /> Reactivar
                  </>
                )}
              </Button>
            )}
            <ConfirmButton
              label="Eliminar"
              confirmLabel="Sí, eliminar"
              question="¿Eliminar esta planta?"
              busy={busy}
              onConfirm={() => void remove()}
            />
          </>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}

      {m && (
        <section
          aria-label="Indicadores"
          className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
        >
          <Stat
            label="Estado"
            value={<StatusBadge status={m.status} />}
            detail={
              m.last_metric_date
                ? `Último día calculado: ${formatDate(m.last_metric_date)}`
                : 'Sin días calculados'
            }
          />
          <Stat
            label="Potencia actual"
            value={p.last_power_kw === null ? '—' : `${formatNumber(p.last_power_kw, 1)} kW`}
            detail={
              p.last_reading_at
                ? `Lectura ${formatDateTime(p.last_reading_at, timezone)}`
                : 'Sin lecturas'
            }
          />
          <Stat label="Energía de hoy" value={today ? `${today.value} ${today.unit}` : '—'} />
          <Stat
            label="PR corregido · 7 días"
            value={m.pr_temp_7d === null ? '—' : formatPct(m.pr_temp_7d)}
            detail={
              m.deviation_pct === null
                ? undefined
                : `${formatNumber(m.deviation_pct, 1)} % respecto a su normal`
            }
          />
          <Stat
            label="Próximo lavado"
            value={
              m.days_to_cleaning === null
                ? '—'
                : m.days_to_cleaning === 0
                  ? 'Ya'
                  : `${m.days_to_cleaning} ${m.days_to_cleaning === 1 ? 'día' : 'días'}`
            }
            detail={
              m.prediction_confidence
                ? `Confianza ${CONFIDENCE[m.prediction_confidence]}`
                : undefined
            }
          />
        </section>
      )}

      <Notice tone="info">
        <span className="flex items-center gap-2">
          <LineChart aria-hidden="true" className="size-4 shrink-0" />
          Las gráficas de producción, rendimiento y vecinas llegan en la siguiente tarea (F6-T4).
        </span>
      </Notice>

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-base font-semibold">Datos técnicos</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Inclinación">{`${formatNumber(p.tilt_deg, 1)}°`}</Item>
          <Item label="Orientación">{`${formatNumber(p.azimuth_deg, 0)}° (180° = sur)`}</Item>
          <Item label="NOCT">{`${formatNumber(p.noct_c, 1)} °C`}</Item>
          <Item label="Coeficiente γ">{`${formatNumber(p.gamma_pct_per_c, 2)} %/°C`}</Item>
          <Item label="Paneles">
            {p.panel_count === null
              ? p.panel_model
              : `${p.panel_count}${p.panel_model ? ` × ${p.panel_model}` : ''}`}
          </Item>
          <Item label="Número de serie">{p.inverter_serial}</Item>
          <Item label="Puesta en marcha">
            {p.commissioning_date &&
              formatDate(p.commissioning_date, { day: 'numeric', month: 'long', year: 'numeric' })}
          </Item>
          <Item label="Ubicación">
            {p.lat !== null && p.lon !== null ? (
              <a
                className="text-brand-text hover:underline"
                href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                {p.lat}, {p.lon}
              </a>
            ) : null}
          </Item>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {p.inverter_brand === 'simulator' ? (
          <Notice tone="info">
            Inversor simulado: no necesita credenciales. Sus escenarios se editan en “Editar”.
          </Notice>
        ) : (
          <CredentialsPanel plant={p} timezone={timezone} onSaved={() => void plant.reload()} />
        )}
        <EventsPanel plantId={id} timezone={timezone} />
      </div>
    </div>
  );
}

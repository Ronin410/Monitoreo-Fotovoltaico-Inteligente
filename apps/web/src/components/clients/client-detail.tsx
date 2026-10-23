'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { LinkButton, PageHeader } from '@/components/page-header';
import { PlantTable } from '@/components/plants/plant-table';
import { Notice, Spinner } from '@/components/ui';
import { noContent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';
import { clientSchema, plantsResponse } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  );
}

export function ClientDetail({ id }: { id: string }) {
  const { api } = useAuth();
  const router = useRouter();
  const client = useApiQuery(`/clients/${id}`, clientSchema);
  const plants = useApiQuery(`/plants?client_id=${id}&page_size=100`, plantsResponse);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (client.error) {
    return (
      <Notice tone="error">
        {client.error.status === 404
          ? 'Este cliente no existe o fue eliminado.'
          : client.error.message}
      </Notice>
    );
  }
  if (!client.data) return <Spinner />;
  const c = client.data;

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await api(`/clients/${id}`, noContent, { method: 'DELETE' });
      router.push('/clients');
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        title={c.name}
        subtitle={`${c.colonia} · CP ${c.postal_code} · ${c.city}`}
        back={{ href: '/clients', label: 'Clientes' }}
        actions={
          <>
            <LinkButton href={`/clients/${id}/edit`} variant="secondary">
              <Pencil aria-hidden="true" className="size-4" /> Editar
            </LinkButton>
            <ConfirmButton
              label="Eliminar"
              confirmLabel="Sí, eliminar"
              question="¿Eliminar este cliente?"
              busy={deleting}
              onConfirm={() => void remove()}
            />
          </>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-base font-semibold">Datos del cliente</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Contacto">{c.contact_name}</Item>
          <Item label="Teléfono">{c.phone}</Item>
          <Item label="Correo">{c.email}</Item>
          <Item label="Dirección">{c.address}</Item>
          <Item label="Ubicación">
            <a
              className="text-brand-text hover:underline"
              href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.lat}, {c.lon}
            </a>
          </Item>
          <Item label="Tarifa CFE">{c.cfe_tariff}</Item>
          <Item label="Consumo mensual">
            {c.avg_monthly_kwh === null ? null : `${formatNumber(c.avg_monthly_kwh)} kWh`}
          </Item>
          <Item label="Recibo mensual">
            {c.avg_monthly_bill_mxn === null
              ? null
              : `$${formatNumber(c.avg_monthly_bill_mxn)} MXN`}
          </Item>
          <Item label="Correo para reportes">{c.report_email}</Item>
        </dl>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Plantas</h2>
          <LinkButton href={`/plants/new?client_id=${id}`}>
            <Plus aria-hidden="true" className="size-4" /> Nueva planta
          </LinkButton>
        </div>
        {plants.error ? (
          <Notice tone="error">{plants.error.message}</Notice>
        ) : !plants.data ? (
          <Spinner />
        ) : plants.data.data.length === 0 ? (
          <Notice tone="info">Este cliente aún no tiene plantas.</Notice>
        ) : (
          <PlantTable plants={plants.data.data} showClient={false} />
        )}
      </section>
    </div>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { ClientForm } from '@/components/clients/client-form';
import { PageHeader } from '@/components/page-header';
import { Notice, Spinner } from '@/components/ui';
import { clientSchema } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApiQuery(`/clients/${id}`, clientSchema);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={data ? `Editar ${data.name}` : 'Editar cliente'}
        back={{ href: `/clients/${id}`, label: 'Cliente' }}
      />
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : data ? (
        <ClientForm client={data} />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

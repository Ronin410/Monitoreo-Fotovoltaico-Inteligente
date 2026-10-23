'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { PlantForm } from '@/components/plants/plant-form';
import { Notice, Spinner } from '@/components/ui';
import { plantSchema } from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';

export default function EditPlantPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApiQuery(`/plants/${id}`, plantSchema);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={data ? `Editar ${data.name}` : 'Editar planta'}
        back={{ href: `/plants/${id}`, label: 'Planta' }}
      />
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : data ? (
        <Suspense>
          <PlantForm plant={data} />
        </Suspense>
      ) : (
        <Spinner />
      )}
    </div>
  );
}

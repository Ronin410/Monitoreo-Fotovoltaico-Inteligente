import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { PlantForm } from '@/components/plants/plant-form';

export const metadata = { title: 'Nueva planta · PV-IoT' };

export default function NewPlantPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Nueva planta" back={{ href: '/plants', label: 'Plantas' }} />
      <Suspense>
        <PlantForm />
      </Suspense>
    </div>
  );
}

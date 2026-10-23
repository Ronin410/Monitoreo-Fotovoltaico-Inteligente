'use client';

import { useParams } from 'next/navigation';
import { PlantDetail } from '@/components/plants/plant-detail';

export default function PlantPage() {
  return <PlantDetail id={useParams<{ id: string }>().id} />;
}

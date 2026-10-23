'use client';

import { useParams } from 'next/navigation';
import { ClientDetail } from '@/components/clients/client-detail';

export default function ClientPage() {
  return <ClientDetail id={useParams<{ id: string }>().id} />;
}

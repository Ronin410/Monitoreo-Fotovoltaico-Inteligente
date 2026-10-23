'use client';

import { useParams } from 'next/navigation';
import { AlertDetail } from '@/components/alerts/alert-detail';

export default function AlertPage() {
  return <AlertDetail id={useParams<{ id: string }>().id} />;
}

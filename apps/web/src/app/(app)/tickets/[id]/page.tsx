'use client';

import { useParams } from 'next/navigation';
import { TicketDetail } from '@/components/tickets/ticket-detail';

export default function TicketPage() {
  return <TicketDetail id={useParams<{ id: string }>().id} />;
}

import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { TicketForm } from '@/components/tickets/ticket-form';

export const metadata = { title: 'Nuevo ticket · PV-IoT' };

export default function NewTicketPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Nuevo ticket" back={{ href: '/tickets', label: 'Tickets' }} />
      <Suspense>
        <TicketForm />
      </Suspense>
    </div>
  );
}

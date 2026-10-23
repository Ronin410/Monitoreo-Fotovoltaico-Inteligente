import { ClientForm } from '@/components/clients/client-form';
import { PageHeader } from '@/components/page-header';

export const metadata = { title: 'Nuevo cliente · PV-IoT' };

export default function NewClientPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Nuevo cliente" back={{ href: '/clients', label: 'Clientes' }} />
      <ClientForm />
    </div>
  );
}

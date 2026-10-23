import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Ticket · PV-IoT' };

export default function Page() {
  return (
    <ComingSoon
      title="Ticket"
      task="F6-T5"
      description="Detalle con la planta, la dirección, el mapa y los cambios de estado."
    />
  );
}

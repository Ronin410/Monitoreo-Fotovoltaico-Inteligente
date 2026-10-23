import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Alerta · PV-IoT' };

export default function Page() {
  return (
    <ComingSoon
      title="Alerta"
      task="F6-T5"
      description="Detalle con evidencia, explicación y acciones: reconocer, crear ticket o descartar."
    />
  );
}

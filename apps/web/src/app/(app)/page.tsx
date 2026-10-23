import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Tablero · PV-IoT' };

export default function DashboardPage() {
  return (
    <ComingSoon
      title="Tablero de flota"
      task="F6-T2"
      description="Tarjetas de resumen, mapa de plantas por estado, alertas que requieren atención, próximos lavados y mejores y peores plantas."
    />
  );
}

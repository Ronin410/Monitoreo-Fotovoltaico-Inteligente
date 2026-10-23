import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Salud del sistema · PV-IoT' };

export default function Page() {
  return (
    <ComingSoon
      title="Salud del sistema"
      task="F6-T6"
      description="Última ejecución de cada job y errores de integración."
    />
  );
}

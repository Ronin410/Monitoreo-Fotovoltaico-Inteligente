import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

// Página pública para interesados (docs/plan-lanzamiento.md 6.7). Sin sesión.

export const metadata: Metadata = {
  title: 'PV-IoT · Monitoreo fotovoltaico inteligente para instaladoras',
  description:
    'Todas las plantas solares de sus clientes en un solo lugar: rendimiento real, cuándo conviene lavar, alertas de fallas y reportes mensuales con su marca.',
  openGraph: {
    title: 'PV-IoT · Monitoreo fotovoltaico inteligente',
    description:
      'Rendimiento real, predicción de lavado, alertas de fallas y reportes mensuales para empresas instaladoras de sistemas solares.',
    locale: 'es_MX',
    type: 'website',
  },
};

export default function InicioPage() {
  return <LandingPage />;
}

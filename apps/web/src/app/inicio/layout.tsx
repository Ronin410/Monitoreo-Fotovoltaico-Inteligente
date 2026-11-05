import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/landing/site';
import { SiteHeader } from '@/components/landing/site-header';

// Sitio público para interesados (docs/plan-lanzamiento.md 6.7): menú, contenido y pie. Sin sesión.

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900"
      >
        Ir al contenido
      </a>
      <SiteHeader />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

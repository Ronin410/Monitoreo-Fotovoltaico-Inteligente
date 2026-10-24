import type { ReactNode } from 'react';
import { LegalLinks } from './legal-page';

/** Marco de las pantallas de autenticación (sin marca de empresa: aún no se sabe cuál es). */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          PV-IoT
          <span className="block text-sm font-normal text-slate-600 dark:text-slate-400">
            Monitoreo fotovoltaico inteligente
          </span>
        </p>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="mb-5 text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          {children}
        </div>
        <LegalLinks className="mt-4 w-full justify-center text-sm" />
      </div>
    </main>
  );
}

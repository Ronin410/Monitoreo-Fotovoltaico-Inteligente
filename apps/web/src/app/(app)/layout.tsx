'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canVisit, homeFor } from '@/lib/nav';

/** Rutas con sesión: sin sesión lleva al login; sin permiso, a su inicio. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (
      state.status === 'authenticated' &&
      pathname === '/' &&
      homeFor(state.user.role) !== '/'
    ) {
      router.replace(homeFor(state.user.role));
    }
  }, [state, pathname, router]);

  if (state.status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const allowed = canVisit(state.user.role, pathname);
  return (
    <AppShell user={state.user} company={state.company}>
      {allowed ? (
        children
      ) : pathname === '/' ? (
        <Spinner />
      ) : (
        <div className="mx-auto flex max-w-lg flex-col gap-4">
          <Notice tone="error">No tienes acceso a esta sección.</Notice>
          <Link href={homeFor(state.user.role)} className="text-sm text-brand-text hover:underline">
            Ir a mi inicio
          </Link>
        </div>
      )}
    </AppShell>
  );
}

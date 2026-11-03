'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Notice } from '@/components/ui';
import { noContent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

/**
 * Aceptación de los términos y el aviso de privacidad vigentes (docs/plan-lanzamiento.md 3.5):
 * se muestra a quien todavía no acepta esta versión, antes de usar la plataforma.
 */
export function AcceptTerms({ version }: { version: string }) {
  const { api, reload, logout } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      await api('/me/accept-terms', noContent, { method: 'POST', body: { version } });
      await reload();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-xl font-semibold">Términos de uso y aviso de privacidad</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Para seguir usando PV-IoT, lea y acepte la versión vigente ({version}) de los{' '}
        <Link href="/terminos" target="_blank" className="text-brand-text underline">
          Términos de uso
        </Link>{' '}
        y del{' '}
        <Link href="/privacidad" target="_blank" className="text-brand-text underline">
          Aviso de privacidad
        </Link>
        .
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          Leí y acepto los términos de uso y el aviso de privacidad.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!checked || busy}>
            {busy ? 'Guardando…' : 'Aceptar y continuar'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </form>
    </div>
  );
}

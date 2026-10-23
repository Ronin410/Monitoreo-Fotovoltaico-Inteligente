'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { canVisit, homeFor, safeNext } from '@/lib/nav';

export function LoginForm() {
  const { state, login } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const role = state.user.role;
    router.replace(next && canVisit(role, next) ? next : homeFor(role));
  }, [state, next, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Iniciar sesión">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Correo" id="email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Contraseña"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
        <Link
          href="/recuperar-contrasena"
          className="text-center text-sm text-brand-text underline-offset-2 hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </Link>
      </form>
    </AuthCard>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Notice } from '@/components/ui';
import { noContent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

const PASSWORD_HINT = 'De 10 a 128 caracteres.';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const { api } = useAuth();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', noContent, {
        method: 'POST',
        body: { token, password },
        noRetry: true,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Nueva contraseña">
      {done ? (
        <div className="flex flex-col gap-4">
          <Notice tone="success">Listo: tu contraseña cambió. Ya puedes iniciar sesión.</Notice>
          <Link href="/login" className="text-center text-sm text-brand hover:underline">
            Iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Field
            label="Nueva contraseña"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            minLength={10}
            maxLength={128}
            required
          />
          <Field
            label="Repite la contraseña"
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar contraseña'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

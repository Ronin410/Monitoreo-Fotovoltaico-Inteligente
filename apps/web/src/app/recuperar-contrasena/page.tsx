'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { okResponse } from '@/lib/schemas';

export default function ForgotPasswordPage() {
  const { api } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', okResponse, {
        method: 'POST',
        body: { email },
        noRetry: true,
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Recuperar contraseña">
      {sent ? (
        <div className="flex flex-col gap-4">
          {/* Mismo mensaje exista o no el correo (specs/02). */}
          <Notice tone="success">
            Si el correo está registrado, te enviamos un enlace para definir una nueva contraseña.
            Vence en una hora.
          </Notice>
          <Link href="/login" className="text-center text-sm text-brand hover:underline">
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Field
            label="Correo"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar enlace'}
          </Button>
          <Link href="/login" className="text-center text-sm text-brand hover:underline">
            Volver a iniciar sesión
          </Link>
        </form>
      )}
    </AuthCard>
  );
}

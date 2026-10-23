'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { homeFor, ROLE_LABELS } from '@/lib/nav';
import { invitationResponse, sessionResponse } from '@/lib/schemas';
import type { z } from 'zod';

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { api, startSession } = useAuth();
  const router = useRouter();
  const [invitation, setInvitation] = useState<z.infer<typeof invitationResponse> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/auth/invitations/${encodeURIComponent(token)}`, invitationResponse, { noRetry: true })
      .then(setInvitation)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [api, token]);

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
      const session = await api(
        `/auth/invitations/${encodeURIComponent(token)}/accept`,
        sessionResponse,
        {
          method: 'POST',
          body: { name: String(form.get('name') ?? ''), password },
          noRetry: true,
        },
      );
      await startSession(session);
      router.replace(homeFor(session.user.role));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!invitation) {
    return (
      <AuthCard title="Aceptar invitación">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <Spinner label="Revisando la invitación…" />
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Únete a ${invitation.company_name}`}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Notice tone="info">
          Te invitaron como <strong>{ROLE_LABELS[invitation.role].toLowerCase()}</strong> con el
          correo {invitation.email}.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Tu nombre" id="name" name="name" autoComplete="name" required />
        <Field
          label="Contraseña"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="De 10 a 128 caracteres."
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
          {busy ? 'Creando tu cuenta…' : 'Crear cuenta'}
        </Button>
      </form>
    </AuthCard>
  );
}

'use client';

import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { fieldErrors, SelectInput, TextInput, type FieldErrors } from '@/components/form';
import { Pagination } from '@/components/pagination';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  companyUserSchema,
  companyUsersPage,
  invitationSchema,
  pendingInvitations,
  ROLE_HINTS,
  ROLE_LABELS,
  type CompanyRole,
  type CompanyUser,
} from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Usuarios de la empresa (specs/09 §Configuración): invitar, cambiar rol, desactivar. La API
// impide cambiarse a uno mismo y quedarse sin administrador activo.

const PAGE_SIZE = 25;
const ROLES: CompanyRole[] = ['company_admin', 'operator', 'technician'];
const STATUS = { active: 'Activo', disabled: 'Desactivado', invited: 'Invitado' } as const;
const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const select =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';

function InviteForm({ onInvited }: { onInvited: (email: string) => void }) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const inv = await api('/company/invitations', invitationSchema, {
        method: 'POST',
        body: { email: String(f.get('email') ?? '').trim(), role: f.get('role') },
      });
      form.reset();
      onInvited(inv.email);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-3"
      aria-label="Invitar usuario"
    >
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-start">
        <TextInput
          id="email"
          label="Correo"
          type="email"
          required
          autoComplete="off"
          error={errors.email}
        />
        <SelectInput
          id="role"
          label="Rol"
          defaultValue="operator"
          error={errors.role}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <Button type="submit" disabled={busy} className="sm:mt-7">
          <UserPlus aria-hidden="true" className="size-4" /> {busy ? 'Enviando…' : 'Invitar'}
        </Button>
      </div>
      <ul className="grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-3 dark:text-slate-400">
        {ROLES.map((r) => (
          <li key={r}>
            <span className="font-semibold">{ROLE_LABELS[r]}:</span> {ROLE_HINTS[r]}
          </li>
        ))}
      </ul>
    </form>
  );
}

function UserRow({
  user,
  self,
  timezone,
  onChange,
}: {
  user: CompanyUser;
  self: boolean;
  timezone: string;
  onChange: (u: CompanyUser) => void;
}) {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await api(`/company/users/${user.id}`, companyUserSchema, { method: 'PATCH', body }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const role = user.role === 'superadmin' ? null : user.role;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium break-words">
            {user.name}
            {self && <span className="text-slate-500 dark:text-slate-400"> (tú)</span>}
          </span>
          <span className="text-sm break-all text-slate-600 dark:text-slate-400">{user.email}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {STATUS[user.status]}
            {user.last_login_at
              ? ` · último acceso ${formatDateTime(user.last_login_at, timezone)}`
              : ' · nunca ha entrado'}
          </span>
        </div>
        {self || !role ? (
          <span className="text-sm">{role ? ROLE_LABELS[role] : ''}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`role-${user.id}`}>
              Rol de {user.name}
            </label>
            <select
              id={`role-${user.id}`}
              value={role}
              disabled={busy || user.status === 'disabled'}
              onChange={(e) => void patch({ role: e.target.value })}
              className={select}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {user.status === 'disabled' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void patch({ status: 'active' })}
              >
                Reactivar
              </Button>
            ) : (
              <ConfirmButton
                label="Desactivar"
                confirmLabel="Sí, desactivar"
                question={`¿Desactivar a ${user.name}? Se cerrarán sus sesiones.`}
                busy={busy}
                onConfirm={() => void patch({ status: 'disabled' })}
              />
            )}
          </div>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

export function UsersPanel({ timezone }: { timezone: string }) {
  const { state } = useAuth();
  const selfId = state.status === 'authenticated' ? state.user.id : null;
  const [page, setPage] = useState(1);
  const users = useApiQuery(`/company/users?page=${page}&page_size=${PAGE_SIZE}`, companyUsersPage);
  const invitations = useApiQuery('/company/invitations', pendingInvitations);
  const [invited, setInvited] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Record<string, CompanyUser>>({});

  return (
    <section className={card} aria-labelledby="users-title">
      <h2 id="users-title" className="text-base font-semibold">
        Usuarios
      </h2>
      <InviteForm
        onInvited={(email) => {
          setInvited(email);
          void invitations.reload();
        }}
      />
      {invited && (
        <Notice tone="success">
          Invitación enviada a {invited}. Tiene 7 días para aceptarla y elegir su contraseña.
        </Notice>
      )}
      {invitations.data && invitations.data.data.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Invitaciones pendientes</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {invitations.data.data.map((i) => (
              <li key={i.id} className="flex flex-wrap gap-x-2 text-slate-700 dark:text-slate-300">
                <span className="break-all">{i.email}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  · {ROLE_LABELS[i.role]} · vence {formatDateTime(i.expires_at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {users.error ? (
        <Notice tone="error">{users.error.message}</Notice>
      ) : !users.data ? (
        <Spinner />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {users.data.data.map((u) => (
              <UserRow
                key={u.id}
                user={updated[u.id] ?? u}
                self={u.id === selfId}
                timezone={timezone}
                onChange={(next) => setUpdated((prev) => ({ ...prev, [next.id]: next }))}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={users.data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

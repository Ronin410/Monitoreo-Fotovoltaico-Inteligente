'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { Filter } from '@/components/filter';
import {
  fieldErrors,
  invalidNumbers,
  numberOrNull,
  SelectInput,
  TextInput,
  textOrNull,
  type FieldErrors,
} from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatNumber } from '@/lib/format';
import {
  adminCompaniesPage,
  adminCompanySchema,
  companyCreated,
  exampleDataQueued,
  purgeQueued,
  invitationResent,
  formatTokens,
  MEXICO_TIMEZONES,
  type AdminCompany,
} from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Empresas (specs/09 §Superadmin): crear con invitación al primer admin, suspender, ver plantas
// y uso de IA. El superadmin no entra a los datos de las empresas (specs/02).

const PAGE_SIZE = 25;
const DEFAULT_BUDGET = 2_000_000;
const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (notice: { tone: 'success' | 'error'; text: string }) => void;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const bad = invalidNumbers(f, ['ai_monthly_token_budget']);
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const budget = numberOrNull(f, 'ai_monthly_token_budget');
      const created = await api('/admin/companies', companyCreated, {
        method: 'POST',
        body: {
          name: String(f.get('name') ?? '').trim(),
          slug: textOrNull(f, 'slug') ?? undefined,
          timezone: String(f.get('timezone') ?? ''),
          plan: textOrNull(f, 'plan') ?? undefined,
          ai_monthly_token_budget: budget ?? undefined,
          admin_email: String(f.get('admin_email') ?? '').trim(),
        },
      });
      onCreated(
        created.email_sent
          ? {
              tone: 'success',
              text: `Empresa “${created.company.name}” creada. Se envió la invitación a ${created.invitation.email}.`,
            }
          : {
              tone: 'error',
              text: `Empresa “${created.company.name}” creada, pero no se pudo enviar la invitación a ${created.invitation.email}. Revise la configuración de correo (Resend) en el servidor.`,
            },
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className={card} aria-labelledby="new-company-title">
      <h2 id="new-company-title" className="text-base font-semibold">
        Nueva empresa
      </h2>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput id="name" label="Nombre" required maxLength={120} error={errors.name} />
        <TextInput
          id="admin_email"
          label="Correo del primer administrador"
          type="email"
          required
          error={errors.admin_email}
          hint="Recibe una invitación para elegir su contraseña."
        />
        <TextInput
          id="slug"
          label="Identificador (slug)"
          maxLength={60}
          error={errors.slug}
          hint="Opcional; se genera del nombre. Minúsculas, números y guiones."
        />
        <SelectInput
          id="timezone"
          label="Zona horaria"
          defaultValue="America/Mazatlan"
          error={errors.timezone}
          options={MEXICO_TIMEZONES}
        />
        <TextInput id="plan" label="Plan" maxLength={40} placeholder="piloto" error={errors.plan} />
        <TextInput
          id="ai_monthly_token_budget"
          label="Presupuesto mensual de IA (tokens)"
          hint="Tokens del modelo, no pesos: 2,000,000 alcanza para un uso normal de un mes."
          inputMode="numeric"
          defaultValue={String(DEFAULT_BUDGET)}
          error={errors.ai_monthly_token_budget}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear e invitar'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function CompanyItem({
  company,
  onChange,
}: {
  company: AdminCompany;
  onChange: (c: AdminCompany) => void;
}) {
  const { api, state } = useAuth();
  const simulator = state.status === 'authenticated' && state.features.simulator;
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const c = company;
  const ratio =
    c.ai_monthly_token_budget > 0 ? c.ai_tokens_this_month / c.ai_monthly_token_budget : 0;
  const prefix = `c-${c.id}`;

  async function patch(body: object) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      onChange(
        await api(`/admin/companies/${c.id}`, adminCompanySchema, { method: 'PATCH', body }),
      );
      setEditing(false);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${prefix}-${k}`, v])));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendInvitation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get(`${prefix}-invite`) ?? '').trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const inv = await api(`/admin/companies/${c.id}/invitations`, invitationResent, {
        method: 'POST',
        body: { email },
      });
      setInviting(false);
      setNotice(
        inv.email_sent
          ? { tone: 'success', text: `Invitación enviada a ${inv.email}.` }
          : {
              tone: 'error',
              text: `La invitación a ${inv.email} se guardó, pero el correo no salió. Revise la configuración de correo (Resend).`,
            },
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadExampleData() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/companies/${c.id}/example-data`, exampleDataQueued, { method: 'POST' });
      setNotice({
        tone: 'success',
        text: 'Cargando datos de ejemplo: 20 clientes y 25 plantas con 90 días de historia. Tarda unos minutos; después entre como administrador de la empresa para verlos.',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function purge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const slug = String(new FormData(e.currentTarget).get(`${prefix}-purge`) ?? '').trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/admin/companies/${c.id}/purge`, purgeQueued, {
        method: 'POST',
        body: { confirm_slug: slug },
      });
      setPurging(false);
      setNotice({
        tone: 'success',
        text: 'Borrando la empresa y todos sus datos. Tarda unos minutos; después desaparece de la lista.',
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const bad = invalidNumbers(f, [`${prefix}-ai_monthly_token_budget`]);
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    void patch({
      plan: String(f.get(`${prefix}-plan`) ?? '').trim(),
      ai_monthly_token_budget: numberOrNull(f, `${prefix}-ai_monthly_token_budget`) ?? 0,
    });
  }

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 rounded"
            style={{ background: c.brand_color }}
          />
          <div className="flex min-w-0 flex-col">
            <span className="font-medium break-words">
              {c.name}{' '}
              {c.status === 'suspended' && (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                  Suspendida
                </span>
              )}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {c.slug} · plan {c.plan} · desde{' '}
              {formatDate(c.created_at.slice(0, 10), {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Plantas</dt>
            <dd className="font-semibold tabular-nums">{formatNumber(c.plant_count)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">IA este mes</dt>
            <dd
              className={`font-semibold tabular-nums ${ratio >= 0.8 ? 'text-red-700 dark:text-red-400' : ''}`}
            >
              {formatTokens(c.ai_tokens_this_month)} / {formatTokens(c.ai_monthly_token_budget)}
            </dd>
          </div>
        </dl>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {editing ? (
        <form
          onSubmit={onSave}
          noValidate
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-start"
        >
          <TextInput
            id={`${prefix}-plan`}
            label="Plan"
            maxLength={40}
            defaultValue={c.plan}
            error={errors[`${prefix}-plan`]}
          />
          <TextInput
            id={`${prefix}-ai_monthly_token_budget`}
            label="Presupuesto de IA (tokens)"
            hint="Tokens del modelo, no pesos: 2,000,000 alcanza para un uso normal de un mes."
            inputMode="numeric"
            defaultValue={String(c.ai_monthly_token_budget)}
            error={errors[`${prefix}-ai_monthly_token_budget`]}
          />
          <Button type="submit" disabled={busy} className="sm:mt-7">
            Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="sm:mt-7"
            onClick={() => setEditing(false)}
          >
            Cancelar
          </Button>
        </form>
      ) : purging ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40"
          onSubmit={(e) => void purge(e)}
          noValidate
        >
          <p className="text-sm text-red-900 dark:text-red-200">
            <strong>Esto no se puede deshacer.</strong> Se borran la empresa, sus usuarios,
            clientes, plantas, lecturas, alertas, tickets, reportes, archivos y auditoría.{' '}
            {c.last_export_at
              ? `Su administrador exportó sus datos el ${formatDate(c.last_export_at.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}.`
              : 'Su administrador nunca exportó sus datos: pídale que lo haga antes (Configuración → Exportar datos), reactivando la empresa si hace falta.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <TextInput
              id={`${prefix}-purge`}
              label={`Escriba el identificador "${c.slug}" para confirmar`}
              autoComplete="off"
              required
            />
            <Button
              type="submit"
              disabled={busy}
              className="bg-red-700 hover:bg-red-800 sm:mt-7 dark:bg-red-700"
            >
              {busy ? 'Borrando…' : 'Borrar definitivamente'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="sm:mt-7"
              onClick={() => setPurging(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : inviting ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(e) => void resendInvitation(e)}
          noValidate
        >
          <TextInput
            id={`${prefix}-invite`}
            label="Correo del administrador"
            type="email"
            required
            hint="Se crea una invitación nueva como administrador de la empresa."
          />
          <Button type="submit" disabled={busy} className="sm:mt-7">
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="sm:mt-7"
            onClick={() => setInviting(false)}
          >
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Plan y presupuesto
          </Button>
          {c.status === 'active' && (
            <Button type="button" variant="secondary" onClick={() => setInviting(true)}>
              Reenviar invitación
            </Button>
          )}
          {simulator && c.status === 'active' && c.plant_count === 0 && (
            <ConfirmButton
              label="Cargar datos de ejemplo"
              confirmLabel="Sí, cargar"
              question="¿Cargar 20 clientes y 25 plantas simuladas con 90 días de historia?"
              busy={busy}
              onConfirm={() => void loadExampleData()}
            />
          )}
          {c.status === 'active' ? (
            <ConfirmButton
              label="Suspender"
              confirmLabel="Sí, suspender"
              question="¿Suspender? Sus usuarios no podrán entrar y se detienen sus jobs."
              busy={busy}
              onConfirm={() => void patch({ status: 'suspended' })}
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void patch({ status: 'active' })}
            >
              Reactivar
            </Button>
          )}
          {c.status === 'suspended' && (
            <Button type="button" variant="ghost" onClick={() => setPurging(true)}>
              Borrar definitivamente
            </Button>
          )}
        </div>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </li>
  );
}

export function CompaniesView() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [updated, setUpdated] = useState<Record<string, AdminCompany>>({});
  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (status) params.set('status', status);
  const { data, error, loading, reload } = useApiQuery(
    `/admin/companies?${params}`,
    adminCompaniesPage,
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Empresas"
        subtitle={data ? `${data.total} ${data.total === 1 ? 'empresa' : 'empresas'}` : undefined}
        actions={
          !creating && (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" /> Nueva empresa
            </Button>
          )
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {creating && (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={(msg) => {
            setNotice(msg);
            setCreating(false);
            setPage(1);
            void reload();
          }}
        />
      )}
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <Filter
          id="status"
          label="Estado"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Todas' },
            { value: 'active', label: 'Activas' },
            { value: 'suspended', label: 'Suspendidas' },
          ]}
        />
      </div>
      {error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : loading && !data ? (
        <Spinner />
      ) : data && data.data.length === 0 ? (
        <Notice tone="info">No hay empresas con ese filtro.</Notice>
      ) : data ? (
        <section className={card} aria-label="Lista de empresas">
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((c) => (
              <CompanyItem
                key={c.id}
                company={updated[c.id] ?? c}
                onChange={(next) => setUpdated((prev) => ({ ...prev, [next.id]: next }))}
              />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </section>
      ) : null}
    </div>
  );
}

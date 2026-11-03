'use client';

import { CheckCircle2, KeyRound, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import { fieldErrors, SelectInput, TextInput, type FieldErrors } from '@/components/form';
import { Button, Notice, Spinner } from '@/components/ui';
import { noContent } from '@/lib/api';
import { useAuth, useCompanyTimezone } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  GOODWE_REGIONS,
  integrationStatusSchema,
  integrationsSchema,
  integrationTestSchema,
  type IntegrationStatus,
} from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';

// Integraciones de la empresa (docs/fabricantes/goodwe-openapi.md). GoodWe da acceso a la API a
// cada instaladora ("usuario de organización") con un Client ID y un Client Secret. Aquí se
// capturan; se guardan cifrados y nunca se vuelven a mostrar.

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

function GoodweCard({ status, onChange }: { status: IntegrationStatus; onChange: () => void }) {
  const { api } = useAuth();
  const timezone = useCompanyTimezone();
  const [editing, setEditing] = useState(!status.configured);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function run(action: () => Promise<{ tone: 'success' | 'error'; text: string } | null>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
      onChange();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(
        Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [`goodwe-${k.replace('credentials.', '')}`, v]),
        ),
      );
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErrors({});
    void run(async () => {
      await api('/company/integrations/goodwe', integrationStatusSchema, {
        method: 'PUT',
        body: {
          credentials: {
            client_id: String(f.get('goodwe-client_id') ?? '').trim(),
            client_secret: String(f.get('goodwe-client_secret') ?? '').trim(),
            region: String(f.get('goodwe-region') ?? ''),
          },
        },
      });
      setEditing(false);
      return { tone: 'success', text: 'Llaves guardadas. Ahora pruebe la conexión.' };
    });
  }

  const test = () =>
    run(async () => {
      const r = await api('/company/integrations/goodwe/test', integrationTestSchema, {
        method: 'POST',
      });
      return { tone: r.ok ? 'success' : 'error', text: r.message };
    });

  const remove = () =>
    run(async () => {
      await api('/company/integrations/goodwe', noContent, { method: 'DELETE' });
      setEditing(true);
      return { tone: 'success', text: 'Llaves borradas.' };
    });

  return (
    <section className={card} aria-labelledby="goodwe-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="goodwe-title" className="flex items-center gap-2 text-base font-semibold">
          <KeyRound aria-hidden="true" className="size-4" /> GoodWe (SEMS)
        </h2>
        {status.configured &&
          (status.last_test_ok === null ? (
            <span className="text-sm text-slate-600 dark:text-slate-400">Sin probar</span>
          ) : status.last_test_ok ? (
            <span className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 aria-hidden="true" className="size-4" /> Conectado
            </span>
          ) : (
            <span className="flex items-center gap-1 text-sm text-red-700 dark:text-red-400">
              <XCircle aria-hidden="true" className="size-4" /> Falló la última prueba
            </span>
          ))}
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Para leer sus inversores GoodWe, su empresa necesita acceso a la API de GoodWe como
        <strong> usuario de organización</strong>. Solicítelo a GoodWe con el código de organización
        de su cuenta SEMS+, el correo de esa cuenta y su razón social. Al aprobarlo, GoodWe le
        entrega un <strong>Client ID</strong> y un <strong>Client Secret</strong> y le indica el
        servidor de su cuenta. Las plantas se ubican por el número de serie del inversor.
      </p>
      {status.configured && !editing && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Llaves guardadas
          {status.updated_at && ` el ${formatDateTime(status.updated_at, timezone)}`}
          {status.last_test_at &&
            ` · última prueba el ${formatDateTime(status.last_test_at, timezone)}`}
          . Por seguridad no se vuelven a mostrar.
        </p>
      )}
      {editing ? (
        <form onSubmit={save} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput
            id="goodwe-client_id"
            label="Client ID"
            autoComplete="off"
            required
            error={errors['goodwe-client_id']}
          />
          <TextInput
            id="goodwe-client_secret"
            label="Client Secret"
            type="password"
            autoComplete="new-password"
            required
            error={errors['goodwe-client_secret']}
          />
          <SelectInput
            id="goodwe-region"
            label="Servidor"
            hint="El que le indique GoodWe para su cuenta."
            options={[...GOODWE_REGIONS]}
            error={errors['goodwe-region']}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar llaves'}
            </Button>
            {status.configured && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void test()}>
            {busy ? 'Probando…' : 'Probar conexión'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Cambiar llaves
          </Button>
          <ConfirmButton
            label="Borrar llaves"
            confirmLabel="Sí, borrar"
            question="¿Borrar las llaves de GoodWe? Se dejarán de leer sus inversores GoodWe."
            busy={busy}
            onConfirm={() => void remove()}
          />
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </section>
  );
}

export function IntegrationsPanel() {
  const { data, error, reload } = useApiQuery('/company/integrations', integrationsSchema);
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!data) return <Spinner />;
  const goodwe = data.data.find((i) => i.provider === 'goodwe');
  return (
    <div className="flex flex-col gap-4">
      {goodwe && <GoodweCard status={goodwe} onChange={() => void reload()} />}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Victron se configura en cada planta (token de acceso de VRM y número de instalación), en
        cuanto su adaptador esté listo.
      </p>
    </div>
  );
}

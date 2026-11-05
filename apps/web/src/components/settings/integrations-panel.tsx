'use client';

import { CheckCircle2, KeyRound, XCircle } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
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

// Integraciones de la empresa: llaves de la instaladora, no de cada planta. GoodWe da acceso a la
// API a cada instaladora ("usuario de organización", docs/fabricantes/goodwe-openapi.md); Enphase,
// con el plan Partner (docs/fabricantes/enphase-api-v4.md). Aquí se capturan; se guardan cifradas
// y nunca se vuelven a mostrar.

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

type Field = {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'email';
  hint?: string;
  options?: readonly { value: string; label: string }[];
};

type ProviderInfo = {
  title: string;
  intro: ReactNode;
  fields: Field[];
  removeQuestion: string;
};

const PROVIDERS: Record<string, ProviderInfo> = {
  goodwe: {
    title: 'GoodWe (SEMS)',
    intro: (
      <>
        Para leer sus inversores GoodWe, su empresa necesita acceso a la API de GoodWe como
        <strong> usuario de organización</strong>. Solicítelo a GoodWe con el código de organización
        de su cuenta SEMS+, el correo de esa cuenta y su razón social. Al aprobarlo, GoodWe le
        entrega un <strong>Client ID</strong> y un <strong>Client Secret</strong> y le indica el
        servidor de su cuenta. Las plantas se ubican por el número de serie del inversor.
      </>
    ),
    fields: [
      { name: 'client_id', label: 'Client ID' },
      { name: 'client_secret', label: 'Client Secret', type: 'password' },
      {
        name: 'region',
        label: 'Servidor',
        hint: 'El que le indique GoodWe para su cuenta.',
        options: GOODWE_REGIONS,
      },
    ],
    removeQuestion: '¿Borrar las llaves de GoodWe? Se dejarán de leer sus inversores GoodWe.',
  },
  enphase: {
    title: 'Enphase (Enlighten)',
    intro: (
      <>
        Para leer sus sistemas Enphase, cree una aplicación con el <strong>plan Partner</strong> en
        el portal de desarrolladores de Enphase (developer-v4.enphase.com). Es para instaladoras
        registradas con al menos 10 instalaciones y pide una tarjeta de crédito: incluye 10,000
        consultas gratis al mes y cobra las adicionales. La plataforma lee cada planta cada 2 horas
        para quedarse cerca de lo gratuito. Capture la <strong>API key</strong>, el{' '}
        <strong>Client ID</strong> y el <strong>Client Secret</strong> de la aplicación, y el correo
        y la contraseña de la cuenta de Enlighten de su empresa. En cada planta se captura su número
        de sistema.
      </>
    ),
    fields: [
      { name: 'api_key', label: 'API key', type: 'password' },
      { name: 'client_id', label: 'Client ID' },
      { name: 'client_secret', label: 'Client Secret', type: 'password' },
      { name: 'username', label: 'Correo de Enlighten', type: 'email' },
      { name: 'password', label: 'Contraseña de Enlighten', type: 'password' },
    ],
    removeQuestion: '¿Borrar las llaves de Enphase? Se dejarán de leer sus sistemas Enphase.',
  },
};

function IntegrationCard({
  provider,
  info,
  status,
  onChange,
}: {
  provider: string;
  info: ProviderInfo;
  status: IntegrationStatus;
  onChange: () => void;
}) {
  const { api } = useAuth();
  const timezone = useCompanyTimezone();
  const [editing, setEditing] = useState(!status.configured);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const path = `/company/integrations/${provider}`;

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
          Object.entries(fields).map(([k, v]) => [
            `${provider}-${k.replace('credentials.', '')}`,
            v,
          ]),
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
    const credentials = Object.fromEntries(
      info.fields.map((field) => {
        const value = String(f.get(`${provider}-${field.name}`) ?? '');
        // Las contraseñas se mandan tal cual: un espacio puede ser parte de ellas.
        return [field.name, field.name === 'password' ? value : value.trim()];
      }),
    );
    void run(async () => {
      await api(path, integrationStatusSchema, { method: 'PUT', body: { credentials } });
      setEditing(false);
      return { tone: 'success', text: 'Llaves guardadas. Ahora pruebe la conexión.' };
    });
  }

  const test = () =>
    run(async () => {
      const r = await api(`${path}/test`, integrationTestSchema, { method: 'POST' });
      return { tone: r.ok ? 'success' : 'error', text: r.message };
    });

  const remove = () =>
    run(async () => {
      await api(path, noContent, { method: 'DELETE' });
      setEditing(true);
      return { tone: 'success', text: 'Llaves borradas.' };
    });

  const titleId = `${provider}-title`;
  return (
    <section className={card} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
          <KeyRound aria-hidden="true" className="size-4" /> {info.title}
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
      <p className="text-sm text-slate-700 dark:text-slate-300">{info.intro}</p>
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
        <form
          onSubmit={save}
          noValidate
          autoComplete="off"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {info.fields.map((field) => {
            const id = `${provider}-${field.name}`;
            return field.options ? (
              <SelectInput
                key={id}
                id={id}
                label={field.label}
                hint={field.hint}
                options={[...field.options]}
                error={errors[id]}
              />
            ) : (
              <TextInput
                key={id}
                id={id}
                label={field.label}
                type={field.type ?? 'text'}
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                hint={field.hint}
                required
                error={errors[id]}
              />
            );
          })}
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
            question={info.removeQuestion}
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
  return (
    <div className="flex flex-col gap-4">
      {data.data.map((status) => {
        const info = PROVIDERS[status.provider];
        return info ? (
          <IntegrationCard
            key={status.provider}
            provider={status.provider}
            info={info}
            status={status}
            onChange={() => void reload()}
          />
        ) : null;
      })}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Victron se configura en cada planta (token de acceso de VRM y número de instalación).
      </p>
    </div>
  );
}

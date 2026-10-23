'use client';

import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/components/confirm-button';
import {
  fieldErrors,
  invalidNumbers,
  numberOrNull,
  TextArea,
  TextInput,
  type FieldErrors,
} from '@/components/form';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  companySchema,
  DEFAULT_SETTINGS,
  TECHNICAL_FIELDS,
  THRESHOLD_FIELDS,
  type Company,
} from '@/lib/settings';

// Secciones de settings (specs/09 §Configuración). Cada una se guarda por separado; "Restablecer"
// manda la sección en null y la API vuelve a los valores por defecto del spec.

const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

/** Valor por omisión tal cual (0.438, 4, -0.4), con formato es-MX. */
const plain = (v: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(v);

type Message = { tone: 'error' | 'success'; text: string } | null;

function useSectionSave(onSaved: (c: Company) => void) {
  const { api } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  async function save(settings: object, success: string) {
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      onSaved(await api('/company', companySchema, { method: 'PATCH', body: { settings } }));
      setMessage({ tone: 'success', text: success });
      return true;
    } catch (err) {
      // Los errores vienen como "settings.thresholds.offline_hours"; se muestran en su campo.
      const fields: FieldErrors = {};
      for (const [path, msg] of Object.entries(fieldErrors(err))) {
        fields[path.split('.').at(-1) ?? path] = msg;
      }
      setErrors(fields);
      setMessage({ tone: 'error', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { errors, setErrors, message, busy, save };
}

export function NumbersSection({
  section,
  company,
  onSaved,
}: {
  section: 'thresholds' | 'defaults';
  company: Company;
  onSaved: (c: Company) => void;
}) {
  const fields = section === 'thresholds' ? THRESHOLD_FIELDS : TECHNICAL_FIELDS;
  const values: Record<string, number> = company.settings[section];
  const defaults: Record<string, number> = DEFAULT_SETTINGS[section];
  const { errors, setErrors, message, busy, save } = useSectionSave(onSaved);
  // Cambia la clave del formulario para que los campos tomen los valores restablecidos.
  const [version, setVersion] = useState(0);
  const title = section === 'thresholds' ? 'Umbrales de alertas' : 'Valores técnicos por omisión';
  const customized = fields.filter((f) => values[f.key] !== defaults[f.key]).length;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const bad = invalidNumbers(
      form,
      fields.map((f) => f.key),
    );
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    // Solo los que cambiaron: lo demás sigue los valores por defecto.
    const patch: Record<string, number> = {};
    for (const f of fields) {
      const v = numberOrNull(form, f.key);
      if (v !== null && v !== values[f.key]) patch[f.key] = v;
    }
    void save({ [section]: patch }, 'Cambios guardados.');
  }

  return (
    <form
      key={version}
      onSubmit={onSubmit}
      noValidate
      className={card}
      aria-labelledby={`${section}-title`}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${section}-title`} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {section === 'thresholds'
            ? 'Se aplican desde el siguiente cálculo diario. Cambia solo lo que tu experiencia en campo justifique.'
            : 'Se proponen al dar de alta una planta; cada planta puede tener los suyos.'}{' '}
          {customized === 0
            ? 'Todos están en su valor por omisión.'
            : `${customized} ${customized === 1 ? 'valor personalizado' : 'valores personalizados'}.`}
        </p>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const def = defaults[f.key] ?? 0;
          const changed = values[f.key] !== def;
          return (
            <TextInput
              key={f.key}
              id={f.key}
              label={f.unit ? `${f.label} (${f.unit})` : f.label}
              inputMode="decimal"
              defaultValue={String(values[f.key])}
              error={errors[f.key]}
              hint={
                <>
                  {f.hint}{' '}
                  <span className={changed ? 'font-semibold' : undefined}>
                    Por omisión: {plain(def)}
                    {changed ? ' (personalizado)' : ''}
                  </span>
                </>
              }
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </Button>
        {customized > 0 && (
          <ConfirmButton
            label="Restablecer"
            confirmLabel="Sí, restablecer"
            question="¿Volver todos a su valor por omisión?"
            busy={busy}
            onConfirm={() =>
              void save({ [section]: null }, 'Valores restablecidos.').then(
                (ok) => ok && setVersion((v) => v + 1),
              )
            }
          />
        )}
      </div>
    </form>
  );
}

/** Correos de alertas (además de los usuarios) y envío automático de reportes. */
export function NotificationsSection({
  company,
  onSaved,
}: {
  company: Company;
  onSaved: (c: Company) => void;
}) {
  const n = company.settings.notifications;
  const { errors, message, busy, save } = useSectionSave(onSaved);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emails = String(form.get('alert_emails') ?? '')
      .split(/[\s,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    void save(
      {
        notifications: {
          alert_emails: [...new Set(emails.map((v) => v.toLowerCase()))],
          auto_send_client_reports: form.get('auto_send_client_reports') === 'on',
        },
      },
      'Notificaciones guardadas.',
    );
  }

  // El error de un correo llega como "alert_emails.2" → se muestra en el campo.
  const emailError = Object.entries(errors).find(
    ([k]) => k === 'alert_emails' || /^\d+$/.test(k),
  )?.[1];

  return (
    <form onSubmit={onSubmit} noValidate className={card} aria-labelledby="notif-title">
      <h2 id="notif-title" className="text-base font-semibold">
        Notificaciones
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <TextArea
        id="alert_emails"
        label="Correos que reciben las alertas"
        defaultValue={n.alert_emails.join('\n')}
        error={emailError}
        hint="Uno por línea, hasta 20. Además, las alertas llegan a los administradores, y el resumen diario a administradores y operadores."
      />
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="auto_send_client_reports"
          defaultChecked={n.auto_send_client_reports}
          className="mt-0.5 size-5 accent-brand"
        />
        <span>
          <span className="font-medium">
            Enviar los reportes mensuales a los clientes automáticamente
          </span>
          <span className="block text-slate-600 dark:text-slate-400">
            Si está apagado, se generan y alguien de tu equipo los revisa y envía.
          </span>
        </span>
      </label>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

'use client';

import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fieldErrors, TextInput, type FieldErrors } from '@/components/form';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import {
  BRAND_LABELS,
  credentialsStatus,
  credentialsTestResponse,
  type Plant,
} from '@/lib/inventory';
import type { z } from 'zod';

// Credenciales del inversor, solo de escritura (specs/02, specs/09): nunca se muestran ni se
// devuelven; solo "guardadas el …", Reemplazar y Probar conexión. Los campos exactos de cada
// marca se confirman al implementar su adaptador con documentación oficial (specs/PREGUNTAS.md
// #143); mientras tanto se pide usuario, contraseña y campos adicionales.

type Extra = { key: string; value: string };

export function CredentialsPanel({
  plant,
  timezone,
  onSaved,
}: {
  plant: Plant;
  timezone: string;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const [status, setStatus] = useState<z.infer<typeof credentialsStatus>>(plant.credentials);
  const [editing, setEditing] = useState(!plant.credentials.has_credentials);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const credentials: Record<string, string> = {};
    const username = String(f.get('cred_username') ?? '').trim();
    const password = String(f.get('cred_password') ?? '');
    if (username) credentials.username = username;
    if (password) credentials.password = password;
    for (const x of extras) if (x.key.trim() && x.value) credentials[x.key.trim()] = x.value;
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const saved = await api(`/plants/${plant.id}/credentials`, credentialsStatus, {
        method: 'PUT',
        body: { credentials },
      });
      setStatus(saved);
      setEditing(false);
      setExtras([]);
      form.reset();
      setMessage({
        tone: 'success',
        text: 'Credenciales guardadas (cifradas). Ya puedes probar la conexión.',
      });
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api(`/plants/${plant.id}/credentials/test`, credentialsTestResponse, {
        method: 'POST',
      });
      setStatus((s) => ({ ...s, last_test_at: r.tested_at, last_test_ok: r.ok }));
      setMessage({ tone: r.ok ? 'success' : 'error', text: r.message });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <KeyRound aria-hidden="true" className="size-5" /> Credenciales del portal{' '}
        {BRAND_LABELS[plant.inverter_brand]}
      </h2>
      {status.has_credentials ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          <li>Guardadas el {formatDateTime(status.updated_at ?? '', timezone)}</li>
          {status.last_test_at && (
            <li>
              Última prueba: {formatDateTime(status.last_test_at, timezone)} ·{' '}
              {status.last_test_ok ? 'conexión exitosa' : 'falló'}
            </li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sin credenciales: la planta no se puede monitorear todavía.
        </p>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {editing ? (
        <form onSubmit={save} noValidate className="flex flex-col gap-4" autoComplete="off">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Se guardan cifradas y nunca se vuelven a mostrar. Escribe todas las que pida el portal
            del fabricante.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              id="cred_username"
              label="Usuario del portal"
              autoComplete="off"
              error={errors['credentials']}
            />
            <TextInput
              id="cred_password"
              label="Contraseña del portal"
              type="password"
              autoComplete="new-password"
            />
          </div>
          {extras.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <TextInput
                id={`cred_key_${i}`}
                label="Campo"
                value={x.key}
                placeholder="Por ejemplo: id de planta"
                onChange={(e) =>
                  setExtras(extras.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)))
                }
              />
              <TextInput
                id={`cred_value_${i}`}
                label="Valor"
                type="password"
                autoComplete="new-password"
                value={x.value}
                onChange={(e) =>
                  setExtras(extras.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Quitar campo ${i + 1}`}
                onClick={() => setExtras(extras.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setExtras([...extras, { key: '', value: '' }])}
            >
              <Plus aria-hidden="true" className="size-4" /> Campo adicional
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar credenciales'}
            </Button>
            {status.has_credentials && (
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Reemplazar
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void test()}>
            {busy ? 'Probando…' : 'Probar conexión'}
          </Button>
        </div>
      )}
    </section>
  );
}

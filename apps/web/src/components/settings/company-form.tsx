'use client';

import { Upload } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { fieldErrors, SelectInput, TextInput, type FieldErrors } from '@/components/form';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { brandColor, contrast, onBrand } from '@/lib/brand';
import { errorMessage } from '@/lib/errors';
import { companySchema, logoResponse, MEXICO_TIMEZONES, type Company } from '@/lib/settings';

// Empresa (specs/09 §Configuración): nombre, logo, color de marca y zona horaria. Al guardar se
// relee /me para que la marca se aplique de inmediato en toda la interfaz.

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
const card =
  'flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';

export function CompanyForm({
  company,
  onSaved,
}: {
  company: Company;
  onSaved: (c: Company) => void;
}) {
  const { api, reload } = useAuth();
  const [color, setColor] = useState(company.brand_color.toUpperCase());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const valid = /^#[0-9A-F]{6}$/.test(color);
  const preview = brandColor(color);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const saved = await api('/company', companySchema, {
        method: 'PATCH',
        body: {
          name: String(f.get('name') ?? '').trim(),
          brand_color: color,
          timezone: String(f.get('timezone') ?? ''),
        },
      });
      onSaved(saved);
      await reload();
      setMessage({ tone: 'success', text: 'Datos de la empresa guardados.' });
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setMessage({ tone: 'error', text: 'El logo debe ser PNG, JPG o SVG.' });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setMessage({ tone: 'error', text: 'El logo debe pesar menos de 1 MB.' });
      return;
    }
    setLogoBusy(true);
    setMessage(null);
    try {
      const { logo_url } = await api('/company/logo', logoResponse, { method: 'POST', body: file });
      onSaved({ ...company, logo_url });
      await reload();
      setMessage({ tone: 'success', text: 'Logo actualizado.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setLogoBusy(false);
    }
  }

  const timezones = MEXICO_TIMEZONES.some((t) => t.value === company.timezone)
    ? MEXICO_TIMEZONES
    : [{ value: company.timezone, label: company.timezone }, ...MEXICO_TIMEZONES];

  return (
    <form onSubmit={onSubmit} noValidate className={card} aria-labelledby="empresa-title">
      <h2 id="empresa-title" className="text-base font-semibold">
        Empresa
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          id="name"
          label="Nombre"
          required
          maxLength={120}
          defaultValue={company.name}
          error={errors.name}
          hint="Aparece en la plataforma, los correos y los reportes."
        />
        <SelectInput
          id="timezone"
          label="Zona horaria"
          defaultValue={company.timezone}
          error={errors.timezone}
          options={timezones}
          hint="Define qué es “hoy”, los resúmenes de las 7:00 y las fechas de los reportes."
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor="brand_color"
            className="text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            Color de marca
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir color"
              value={preview.toLowerCase()}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-900"
            />
            <input
              id="brand_color"
              value={color}
              maxLength={7}
              onChange={(e) => setColor(e.target.value.trim().toUpperCase())}
              aria-invalid={!valid || errors.brand_color ? true : undefined}
              aria-describedby="brand_color-hint"
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-base uppercase dark:border-slate-600 dark:bg-slate-900"
            />
          </div>
          <span
            id="brand_color-hint"
            className={`text-xs ${valid && !errors.brand_color ? 'text-slate-600 dark:text-slate-400' : 'font-medium text-red-700 dark:text-red-400'}`}
          >
            {errors.brand_color ??
              (valid
                ? `Botones y acentos. El texto sobre él se elige solo para que se lea (contraste ${contrast(preview, onBrand(preview)).toFixed(1)}:1).`
                : 'Escribe un color como #0E7490.')}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Vista previa
          </span>
          <span
            className="inline-flex min-h-11 w-fit items-center rounded-lg px-4 text-sm font-semibold"
            style={{ background: preview, color: onBrand(preview) }}
          >
            Botón de ejemplo
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="flex size-16 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700">
          {company.logo_url ? (
            // Logo subido por la empresa (servido por la API).
            <img src={company.logo_url} alt="Logo actual" className="size-14 object-contain" />
          ) : (
            <span className="text-xs text-slate-500">Sin logo</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label
            className={`inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 focus-within:outline-2 dark:border-slate-600 dark:hover:bg-slate-800 ${logoBusy ? 'opacity-60' : ''}`}
          >
            <Upload aria-hidden="true" className="size-4" />
            {logoBusy ? 'Subiendo…' : company.logo_url ? 'Cambiar logo' : 'Subir logo'}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
              className="sr-only"
              disabled={logoBusy}
              onChange={(e) => void onLogo(e)}
            />
          </label>
          <span className="text-xs text-slate-600 dark:text-slate-400">
            PNG, JPG o SVG, hasta 1 MB.
          </span>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={busy || !valid}>
          {busy ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

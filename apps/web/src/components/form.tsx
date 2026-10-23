import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '@/lib/api';

// Campos de formulario con etiqueta, ayuda y error accesibles. Los errores de validación de la
// API ({ path, message }) se muestran junto a su campo.

export type FieldErrors = Record<string, string>;

/** Errores por campo de un VALIDATION_ERROR de la API. */
export function fieldErrors(err: unknown): FieldErrors {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const out: FieldErrors = {};
  for (const d of err.details as { path?: unknown; message?: unknown }[]) {
    if (typeof d.path === 'string' && typeof d.message === 'string' && !(d.path in out)) {
      out[d.path] = d.message;
    }
  }
  return out;
}

const control =
  'min-h-11 w-full rounded-lg border bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100';
const border = (error?: string) =>
  error ? 'border-red-500 dark:border-red-500' : 'border-slate-300 dark:border-slate-600';

function Wrapper({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && (
          <span aria-hidden="true" className="text-red-600">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <span id={`${id}-hint`} className="text-xs text-slate-600 dark:text-slate-400">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

const describedBy = (id: string, hint: unknown, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextInput({
  id,
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={props.required}>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} ${border(error)}`}
        {...props}
      />
    </Wrapper>
  );
}

export function SelectInput({
  id,
  label,
  hint,
  error,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={props.required}>
      <select
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} ${border(error)}`}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

export function TextArea({
  id,
  label,
  hint,
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={props.required}>
      <textarea
        id={id}
        name={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} ${border(error)} py-2`}
        {...props}
      />
    </Wrapper>
  );
}

export function Fieldset({
  legend,
  children,
  description,
}: {
  legend: string;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      <legend className="px-1 text-base font-semibold">{legend}</legend>
      {description && (
        <p className="-mt-2 text-sm text-slate-600 dark:text-slate-400">{description}</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Lee un FormData a texto: vacío → null (para que la API borre el valor). */
export function textOrNull(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? '').trim();
  return v === '' ? null : v;
}

/** Número de un campo; vacío → null; texto no numérico → NaN (la API lo rechaza con su mensaje). */
export function numberOrNull(form: FormData, name: string): number | null {
  const v = String(form.get(name) ?? '')
    .trim()
    .replace(',', '.');
  return v === '' ? null : Number(v);
}

/** Campos numéricos con texto que no es número (JSON los mandaría como null). */
export function invalidNumbers(form: FormData, names: string[]): FieldErrors {
  const out: FieldErrors = {};
  for (const n of names) {
    if (Number.isNaN(numberOrNull(form, n)))
      out[n] = 'Escribe un número (usa punto para decimales).';
  }
  return out;
}

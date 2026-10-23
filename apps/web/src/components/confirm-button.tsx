'use client';

import { useState } from 'react';
import { Button } from './ui';

/** Acción destructiva en dos pasos (sin ventana del navegador, accesible con teclado). */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  onConfirm,
  busy,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{question}</span>
      <Button
        type="button"
        className="bg-red-700! text-white!"
        disabled={busy}
        onClick={onConfirm}
        autoFocus
      >
        {busy ? 'Procesando…' : confirmLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
        Cancelar
      </Button>
    </div>
  );
}

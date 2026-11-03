'use client';

import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { HELP, type HelpKey } from '@/lib/help';

const WIDTH = 256;
const GUTTER = 12;

/**
 * Ícono ⓘ con una explicación corta del dato junto al que está. Se abre al pasar el mouse, al
 * enfocarlo con el teclado o al tocarlo en el celular; se cierra con Escape, al salir o tocando
 * fuera. El texto sale de lib/help.ts.
 */
export function InfoTip({ help, label }: { help: HelpKey; label: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /** Debajo del ícono, o arriba si no cabe; siempre dentro de la pantalla. */
  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.min(
      Math.max(GUTTER, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - GUTTER,
    );
    const height = tip.current?.offsetHeight ?? 120;
    const below = r.bottom + 6;
    const top =
      below + height > window.innerHeight - GUTTER && r.top - 6 - height > GUTTER
        ? r.top - 6 - height
        : below;
    setPos({ top, left });
  }, []);
  const open = place;

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onAway = (e: Event) => {
      if (!button.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onAway);
    // Al desplazar la página sigue a su ícono; se cierra si el ícono sale de la pantalla.
    const onScroll = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close();
      else place();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onAway);
      window.removeEventListener('scroll', onScroll);
    };
  }, [pos, close, place]);

  // Ya con su alto real, se vuelve a colocar (puede necesitar ir arriba del ícono).
  const measured = pos !== null;
  useEffect(() => {
    if (measured) place();
  }, [measured, place]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`¿Qué es "${label}"?`}
        aria-describedby={pos ? id : undefined}
        aria-expanded={pos !== null}
        // Pasar el puntero solo cuenta con mouse: al tocar en el celular, el navegador simula que
        // el puntero sale del ícono al levantar el dedo y lo cerraría.
        onPointerEnter={(e) => e.pointerType === 'mouse' && open()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && close()}
        onFocus={open}
        onBlur={close}
        // Tocar abre; tocar fuera (o Escape) cierra.
        onClick={open}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand dark:text-slate-500 dark:hover:text-slate-200"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {pos && (
        <span
          ref={tip}
          id={id}
          role="tooltip"
          style={{
            top: pos.top,
            left: pos.left,
            width: Math.min(WIDTH, window.innerWidth - GUTTER * 2),
          }}
          className="fixed z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs leading-relaxed font-normal text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {HELP[help]}
        </span>
      )}
    </>
  );
}

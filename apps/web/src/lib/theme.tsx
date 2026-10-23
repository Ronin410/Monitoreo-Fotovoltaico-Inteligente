'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// Modo claro y oscuro (specs/09). Por omisión sigue al sistema; la elección se guarda en el
// navegador. THEME_SCRIPT la aplica antes de pintar para que no parpadee.

export type ThemeChoice = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'pv-theme';

export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${STORAGE_KEY}');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', Boolean(dark));
}

const ThemeContext = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({
  choice: 'system',
  setChoice: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');

  useEffect(() => {
    setChoiceState(readChoice());
  }, []);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // Sin almacenamiento (modo privado): la elección dura lo que la pestaña.
    }
    setChoiceState(c);
  }, []);

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

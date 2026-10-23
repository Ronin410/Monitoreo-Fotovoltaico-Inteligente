// Validación de cifras (specs/07 §3): todo número que aparece en un texto de la IA debe existir en
// la evidencia, con tolerancia de redondeo. Así la IA puede decir "15 %" si la evidencia dice
// 15.2, o "86 %" si dice 0.86, pero no inventar "20 %". Días y conteos pueden salir de las fechas
// y del tamaño de las listas; porcentajes y montos, solo de cifras.

/** Enteros pequeños que se aceptan sin estar en la evidencia ("1–2 días", "una o 2 veces"). */
export const FREE_INTEGERS_MAX = 5;

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export type WrittenNumber = {
  value: number;
  decimals: number;
  raw: string;
  /** Es un porcentaje o un monto ("15 %", "$19"): debe salir de una cifra, no de una fecha. */
  measure: boolean;
};

/** Números escritos en un texto, con su cantidad de decimales (es-MX: coma de miles, punto decimal). */
export function numbersIn(text: string): WrittenNumber[] {
  return [...text.matchAll(NUMBER)].map((m) => {
    const raw = m[0];
    const plain = raw.replace(/,/g, '');
    const at = m.index ?? 0;
    const measure = /^\s*%/.test(text.slice(at + raw.length)) || /\$\s*$/.test(text.slice(0, at));
    return { value: Number(plain), decimals: plain.split('.')[1]?.length ?? 0, raw, measure };
  });
}

export type AllowedValues = {
  /** Cifras de la evidencia. */
  figures: number[];
  /** Componentes de fechas y tamaños de listas (días, conteos). */
  counts: number[];
};

/** Valores permitidos: cifras de la evidencia, componentes de sus fechas y tamaños de listas. */
export function allowedValues(evidence: unknown): AllowedValues {
  const out: AllowedValues = { figures: [], counts: [] };
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.figures.push(Math.abs(v));
    else if (typeof v === 'string') {
      const m = DATE.exec(v);
      if (m) out.counts.push(Number(m[1]), Number(m[2]), Number(m[3]));
    } else if (Array.isArray(v)) {
      out.counts.push(v.length);
      v.forEach(walk);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(evidence);
  return out;
}

const roundTo = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** ¿El número escrito corresponde a algún valor (tal cual o como porcentaje de una fracción)? */
function matches(n: WrittenNumber, allowed: AllowedValues): boolean {
  if (!n.measure && n.decimals === 0 && n.value <= FREE_INTEGERS_MAX) return true;
  if (!n.measure && n.decimals === 0 && allowed.counts.includes(n.value)) return true;
  return allowed.figures.some((v) =>
    [v, v * 100].some((c) => Math.abs(roundTo(c, n.decimals) - n.value) < 1e-9),
  );
}

/** Números del texto que no salen de la evidencia (vacío = válido). */
export function unsupportedFigures(texts: string[], evidence: unknown): string[] {
  const values = allowedValues(evidence);
  return texts.flatMap((t) =>
    numbersIn(t)
      .filter((n) => !matches(n, values))
      .map((n) => n.raw),
  );
}

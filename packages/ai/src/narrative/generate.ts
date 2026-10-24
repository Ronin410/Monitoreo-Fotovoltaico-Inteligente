import type { ReportFacts } from '@pv/core';
import { unsupportedFigures } from '../figures.js';
import { REPORT_NARRATIVE_SYSTEM, reportNarrativeMessage } from '../prompts/report-narrative.js';
import { LLMError, responseText, type LLMProvider, type LLMUsage } from '../provider.js';
import { templateNarrative } from './template.js';

// Narrativa del reporte mensual (specs/08 §3): la IA redacta con las cifras de `facts`; si el texto
// no pasa la validación se reintenta una vez y después se usa la plantilla.

/** Margen sobre las 80–150 palabras pedidas antes de rechazar el texto. */
const MIN_WORDS = 60;
const MAX_WORDS = 180;
const JARGON = /\bPR\b|irradian|irradiaci|\bkWp\b/i;

export type NarrativeResult = {
  text: string;
  source: 'ai' | 'template';
  model: string | null;
  usage: LLMUsage[];
  failure: string | null;
};

/** Problemas del texto, o null si es válido. */
export function narrativeProblem(text: string, facts: ReportFacts): string | null {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS)
    return `el texto debe tener entre 80 y 150 palabras (tiene ${words})`;
  if (JARGON.test(text)) return 'no uses "PR", "irradiancia" ni "kWp"';
  const bad = unsupportedFigures([text], facts);
  if (bad.length)
    return `estas cifras no están en los datos: ${bad.join(', ')}. Usa solo cifras de los datos.`;
  return null;
}

export async function generateNarrative(
  provider: LLMProvider,
  model: string,
  facts: ReportFacts,
  companyName: string,
): Promise<NarrativeResult> {
  const usage: LLMUsage[] = [];
  const template = (failure: string): NarrativeResult => ({
    text: templateNarrative(facts, companyName),
    source: 'template',
    model: null,
    usage,
    failure,
  });
  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await provider.generate({
        model,
        system: REPORT_NARRATIVE_SYSTEM,
        messages: [
          { role: 'user', content: reportNarrativeMessage(companyName, facts, correction) },
        ],
        maxTokens: 4_000,
        effort: 'low',
      });
    } catch (err) {
      return template(err instanceof LLMError ? err.message : 'Error del proveedor de IA');
    }
    usage.push(res.usage);
    if (res.stopReason === 'refusal') return template('El modelo declinó la solicitud');
    const text = responseText(res).trim();
    const problem =
      res.stopReason === 'max_tokens' ? 'el texto quedó incompleto' : narrativeProblem(text, facts);
    if (!problem) return { text, source: 'ai', model: res.model, usage, failure: null };
    correction = problem;
  }
  return template(`Texto inválido tras reintentar: ${correction}`);
}

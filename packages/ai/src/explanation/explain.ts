import { unsupportedFigures } from '../figures.js';
import { ALERT_EXPLANATION_SYSTEM, alertExplanationMessage } from '../prompts/alert-explanation.js';
import { LLMError, responseText, type LLMProvider, type LLMUsage } from '../provider.js';
import {
  EXPLANATION_JSON_SCHEMA,
  explanationSchema,
  type Explanation,
  type ExplainInput,
  type StoredExplanation,
} from './schema.js';
import { templateExplanation } from './template.js';

// Explicación IA de una alerta (specs/07 §3): salida JSON validada con zod y validación de cifras;
// si falla se reintenta una vez y, si vuelve a fallar, se usa la plantilla.

const MAX_TOKENS = 4_000;

export type ExplainResult = {
  explanation: StoredExplanation;
  /** Tokens de cada llamada (para ai_usage_monthly). */
  usage: LLMUsage[];
  /** Por qué se usó la plantilla, si se usó. */
  failure: string | null;
};

/** Revisa una respuesta; devuelve la explicación o qué corregir. */
function check(
  text: string,
  input: ExplainInput,
): { ok: true; explanation: Explanation } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'la respuesta no es un JSON válido' };
  }
  const parsed = explanationSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || 'raíz').join(', ');
    return { ok: false, error: `campos inválidos (${where})` };
  }
  const e = parsed.data;
  const bad = unsupportedFigures(
    [e.resumen, e.causa_probable, ...e.otras_causas, ...e.que_revisar],
    input,
  );
  if (bad.length) {
    return {
      ok: false,
      error: `estas cifras no están en los datos: ${bad.join(', ')}. Usa solo cifras de los datos.`,
    };
  }
  return { ok: true, explanation: e };
}

export async function explainAlert(
  provider: LLMProvider,
  model: string,
  input: ExplainInput,
  now: Date,
): Promise<ExplainResult> {
  const usage: LLMUsage[] = [];
  const template = (failure: string): ExplainResult => ({
    explanation: {
      ...templateExplanation(input),
      generated_by: 'template',
      model: null,
      generated_at: now.toISOString(),
    },
    usage,
    failure,
  });

  let correction: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await provider.generate({
        model,
        system: ALERT_EXPLANATION_SYSTEM,
        messages: [{ role: 'user', content: alertExplanationMessage(input, correction) }],
        maxTokens: MAX_TOKENS,
        effort: 'low',
        jsonSchema: EXPLANATION_JSON_SCHEMA,
      });
    } catch (err) {
      // El proveedor ya reintentó los errores de red y 5xx.
      return template(err instanceof LLMError ? err.message : 'Error del proveedor de IA');
    }
    usage.push(res.usage);
    if (res.stopReason === 'refusal') return template('El modelo declinó la solicitud');
    if (res.stopReason === 'max_tokens') {
      correction = 'la respuesta quedó incompleta; sé más breve.';
      continue;
    }
    const result = check(responseText(res), input);
    if (result.ok) {
      return {
        explanation: {
          ...result.explanation,
          generated_by: 'ai',
          model: res.model,
          generated_at: now.toISOString(),
        },
        usage,
        failure: null,
      };
    }
    correction = result.error;
  }
  return template(`Respuesta inválida tras reintentar: ${correction}`);
}

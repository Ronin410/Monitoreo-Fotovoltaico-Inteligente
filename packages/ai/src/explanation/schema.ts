import { z } from 'zod';

// Salida de la explicación de una alerta (specs/07 §3).

const level = z.enum(['baja', 'media', 'alta']);

export const explanationSchema = z.object({
  resumen: z.string().trim().min(1).max(280),
  causa_probable: z.string().trim().min(1).max(160),
  otras_causas: z.array(z.string().trim().min(1).max(160)).max(3),
  confianza: level,
  que_revisar: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  urgencia: level,
});
export type Explanation = z.infer<typeof explanationSchema>;

/**
 * El mismo esquema para la salida estructurada de la API. Sin límites de longitud (no todos se
 * admiten ahí): esos los valida zod al recibir la respuesta.
 */
export const EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'Máximo 280 caracteres.' },
    causa_probable: { type: 'string' },
    otras_causas: { type: 'array', items: { type: 'string' }, description: 'Máximo 3.' },
    confianza: { type: 'string', enum: ['baja', 'media', 'alta'] },
    que_revisar: { type: 'array', items: { type: 'string' }, description: 'De 1 a 5.' },
    urgencia: { type: 'string', enum: ['baja', 'media', 'alta'] },
  },
  required: ['resumen', 'causa_probable', 'otras_causas', 'confianza', 'que_revisar', 'urgencia'],
  additionalProperties: false,
} as const;

/** Lo que se guarda en alerts.ai_explanation: la explicación y de dónde salió. */
export type StoredExplanation = Explanation & {
  generated_by: 'ai' | 'template';
  model: string | null;
  generated_at: string;
};

/** Entrada de la explicación (specs/07 §3 §Entrada). Las cifras ya vienen calculadas. */
export type ExplainInput = {
  alert: {
    type: 'offline' | 'sudden_drop' | 'soiling' | 'cleaning_due_soon';
    severity: 'info' | 'warning' | 'critical';
    detected_at: string;
  };
  /** Evidencia de specs/06 §3 más la pérdida estimada por día. */
  evidence: Record<string, unknown> & {
    estimated_loss_kwh_per_day?: number | null;
    estimated_loss_mxn_per_day?: number | null;
  };
  plant: {
    capacity_kwp: number;
    tilt_deg: number;
    azimuth_deg: number;
    age_years: number | null;
    inverter_brand: string;
  };
  /** Eventos de los últimos 90 días (limpiezas, lluvias, reparaciones). */
  events: { type: string; date: string }[];
  /** Tickets recientes de la planta. */
  tickets: { type: string; status: string; date: string }[];
  today: string;
};

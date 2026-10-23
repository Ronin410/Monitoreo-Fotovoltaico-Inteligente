import type { Explanation, ExplainInput } from './schema.js';

// Plantilla de respaldo por tipo de alerta, sin IA (specs/07 §3): cuando el proveedor falla, la
// respuesta no pasa la validación o se agotó el presupuesto.

const fmt = (v: number, digits = 1) =>
  new Intl.NumberFormat('es-MX', { maximumFractionDigits: digits }).format(v);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lastDeviation(evidence: ExplainInput['evidence']): number | null {
  const trigger = evidence.trigger as { deviation_pct?: unknown[] } | undefined;
  return num(trigger?.deviation_pct?.at(-1));
}

function lossSentence(evidence: ExplainInput['evidence']): string {
  const kwh = num(evidence.estimated_loss_kwh_per_day);
  const mxn = num(evidence.estimated_loss_mxn_per_day);
  if (kwh === null || kwh <= 0) return '';
  return ` Pérdida estimada: ${fmt(kwh)} kWh${mxn === null ? '' : ` (unos $${fmt(mxn, 0)})`} por día.`;
}

const clip = (text: string) => (text.length <= 280 ? text : `${text.slice(0, 279)}…`);

export function templateExplanation(input: ExplainInput): Explanation {
  const e = input.evidence;
  const deviation = lastDeviation(e);
  const below =
    deviation === null ? 'por debajo de su normal' : `${fmt(deviation)} % por debajo de su normal`;
  const neighbors = num((e.neighbors as { neighbor_index?: unknown } | undefined)?.neighbor_index);
  const loss = lossSentence(e);
  const urgent = input.alert.severity === 'critical';

  switch (input.alert.type) {
    case 'soiling': {
      const notRecovered = e.cleaning_did_not_recover === true;
      return {
        resumen: clip(
          notRecovered
            ? `La planta sigue ${below} aun después de un lavado; probablemente no es polvo.${loss}`
            : `La planta rinde ${below} de forma sostenida y sin lluvia que la lave; lo más probable es polvo acumulado.${loss}`,
        ),
        causa_probable: notRecovered
          ? 'Sombra o falla parcial (no se recuperó con el lavado)'
          : 'Acumulación de polvo',
        otras_causas: notRecovered
          ? ['Falla parcial de strings', 'Degradación de módulos']
          : ['Sombra nueva por vegetación o construcción', 'Falla parcial de strings'],
        confianza: notRecovered ? 'media' : 'media',
        que_revisar: notRecovered
          ? [
              'Revisar sombras nuevas sobre los paneles',
              'Medir cada string',
              'Inspeccionar módulos dañados',
            ]
          : [
              'Inspección visual de los paneles',
              'Lavar y confirmar que el rendimiento se recupere',
            ],
        urgencia: 'media',
      };
    }
    case 'sudden_drop':
      return {
        resumen: clip(
          `La producción cayó de golpe y rinde ${below}${neighbors !== null && neighbors < 0.9 ? ', mientras sus vecinas producen normal' : ''}; suele ser una falla de inversor o de strings.${loss}`,
        ),
        causa_probable: 'Falla de inversor o de strings',
        otras_causas: ['Protección o interruptor abierto', 'Sombra o daño físico reciente'],
        confianza: 'media',
        que_revisar: [
          'Revisar alarmas y estado del inversor',
          'Medir voltaje y corriente de cada string',
          'Revisar protecciones, fusibles y conexiones',
        ],
        urgencia: urgent ? 'alta' : 'media',
      };
    case 'offline':
      return {
        resumen: clip(
          `El inversor dejó de reportar datos durante horas con sol; la planta podría estar sin producir o sin conexión.${loss}`,
        ),
        causa_probable: 'Inversor sin conexión a internet o apagado',
        otras_causas: [
          'Corte de energía en el sitio',
          'Cambio de contraseña del portal del fabricante',
        ],
        confianza: 'media',
        que_revisar: [
          'Confirmar con el cliente que el inversor esté encendido',
          'Revisar el WiFi o el datalogger del inversor',
          'Revisar la cuenta del portal del fabricante',
        ],
        urgencia: 'alta',
      };
    case 'cleaning_due_soon':
      return {
        resumen: clip(
          `La tendencia indica que la planta pronto rendirá ${below}; conviene programar un lavado.${loss}`,
        ),
        causa_probable: 'Acumulación gradual de polvo',
        otras_causas: [],
        confianza: 'media',
        que_revisar: ['Programar el lavado de los paneles'],
        urgencia: 'baja',
      };
  }
}

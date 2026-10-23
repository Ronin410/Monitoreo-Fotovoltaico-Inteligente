import { z } from 'zod';
import { defineTool } from './tool.js';

// render_chart (specs/07 §2): el frontend dibuja la gráfica; la herramienta solo valida y
// responde ok. Máximo 400 puntos por gráfica (el límite de 3 por respuesta lo pone el ciclo).

export const MAX_CHART_POINTS = 400;

export const chartSchema = z
  .object({
    type: z.enum(['bar', 'line']),
    title: z.string().min(1).max(120),
    x_label: z.string().max(60).default(''),
    y_label: z.string().max(60).default(''),
    series: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            points: z
              .array(
                z
                  .object({
                    x: z.union([z.string().max(60), z.number()]),
                    y: z.number().nullable(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .refine((c) => c.series.reduce((s, x) => s + x.points.length, 0) <= MAX_CHART_POINTS, {
    error: `Máximo ${MAX_CHART_POINTS} puntos por gráfica`,
  });
export type ChartSpec = z.infer<typeof chartSchema>;

export const renderChart = defineTool({
  name: 'render_chart',
  description:
    'Dibuja una gráfica en la respuesta (barras o línea). Úsala cuando una gráfica explique mejor que un párrafo: tendencias o comparaciones de más de 5 elementos. Los datos deben venir de otras herramientas. Máximo 3 por respuesta y 400 puntos.',
  input: chartSchema,
  run: async () => ({ ok: true }),
});

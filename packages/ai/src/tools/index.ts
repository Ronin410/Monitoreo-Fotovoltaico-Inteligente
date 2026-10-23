import { z } from 'zod';
import type { ToolDefinition } from '../provider.js';
import { renderChart } from './chart.js';
import { ToolError, type ToolContext } from './context.js';
import { getFleetSummary } from './fleet.js';
import { getPlantsAtRisk, listAlerts, listTickets } from './operations.js';
import { getPlantDetail, getPlantTimeseries, searchPlants } from './plants.js';
import { comparePeriods, performanceByZone, rankPlants } from './ranking.js';
import type { AssistantTool } from './tool.js';

// Las 11 herramientas del asistente (specs/07 §2). El modelo solo puede llamar a estas; nunca
// ejecuta SQL libre (CLAUDE.md) y companyId no es parámetro de ninguna.

export const ASSISTANT_TOOLS: AssistantTool[] = [
  getFleetSummary,
  searchPlants,
  rankPlants,
  performanceByZone,
  getPlantsAtRisk,
  getPlantDetail,
  getPlantTimeseries,
  listAlerts,
  listTickets,
  comparePeriods,
  renderChart,
];

/** Definiciones para el modelo, en orden fijo (estable para la caché del prompt). */
export function toolDefinitions(tools: AssistantTool[] = ASSISTANT_TOOLS): ToolDefinition[] {
  return tools.map((t) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(t.input, { io: 'input' }) as Record<
      string,
      unknown
    >;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

export type ToolRun = { ok: true; output: unknown; input: unknown } | { ok: false; error: string };

/**
 * Ejecuta una herramienta. Una entrada inválida o un recurso inexistente regresan un error para
 * que el modelo corrija; los errores internos se propagan.
 */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolRun> {
  const tool = ASSISTANT_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Herramienta desconocida: ${name}` };
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Entrada inválida: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`)
        .join('; ')}`,
    };
  }
  try {
    return { ok: true, output: await tool.run(parsed.data, ctx), input: parsed.data };
  } catch (err) {
    if (err instanceof ToolError) return { ok: false, error: err.message };
    throw err;
  }
}

export { chartSchema, MAX_CHART_POINTS, type ChartSpec } from './chart.js';
export { resolvePeriod, ToolError, type ToolContext } from './context.js';
export type { AssistantTool } from './tool.js';

import type { z } from 'zod';
import type { ToolContext } from './context.js';

/** Una herramienta del asistente: esquema zod de entrada, descripción para el modelo y ejecución. */
export type AssistantTool<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.output<I>, ctx: ToolContext) => Promise<unknown>;
};

export const defineTool = <I extends z.ZodType>(tool: AssistantTool<I>): AssistantTool =>
  tool as unknown as AssistantTool;

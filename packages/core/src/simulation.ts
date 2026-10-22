import { z } from 'zod';

// simulation_profile de una planta con inversor `simulator` (specs/04 §3).

const date = z.iso.date({ error: 'Fecha YYYY-MM-DD' });
const dateTime = z.iso.datetime({ offset: true, error: 'Fecha y hora ISO 8601' });
const pct = z.number().min(0).max(100);

export const simulationScenarioSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('soiling'),
    start: date,
    rate_pct_per_day: z.number().positive().max(5),
  }),
  z.object({
    type: z.literal('string_failure'),
    start: date,
    loss_pct: pct,
    end: date.nullable().default(null),
  }),
  z.object({
    type: z.literal('offline'),
    start: dateTime,
    end: dateTime.nullable().default(null),
  }),
  z.object({
    type: z.literal('shading'),
    start: date,
    loss_pct: pct,
    local_hours: z.array(z.number().int().min(0).max(23)).min(1).max(24),
  }),
]);

export const simulationProfileSchema = z.object({
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1),
  system_efficiency: z.number().min(0.5).max(1),
  ac_limit_kw: z.number().positive().max(100_000),
  noise_pct: z.number().min(0).max(20).default(2),
  scenarios: z.array(simulationScenarioSchema).max(20).default([]),
});

export type SimulationScenario = z.infer<typeof simulationScenarioSchema>;
export type SimulationProfile = z.infer<typeof simulationProfileSchema>;

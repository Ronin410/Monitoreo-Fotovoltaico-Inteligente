import { demoExampleData } from '@pv/adapters';
import { currentPeriod, shiftPeriod } from '@pv/core';
import { loadExampleData } from '../seed/demo.js';
import { registerJob } from '../runtime.js';
import { createMonthlyReports } from './reports.js';

// Datos de ejemplo para una empresa recién creada (staging/demo; specs/PREGUNTAS.md #203).

export const demoExampleDataJob = registerJob(demoExampleData, async (payload, ctx) => {
  const summary = await loadExampleData({ ...ctx, logger: ctx.log }, payload.company_id);
  // Reportes del mes pasado para la pantalla de Reportes (se generan en reports.generate).
  const company = await ctx.serviceDb.company.findUniqueOrThrow({
    where: { id: payload.company_id },
    select: { timezone: true },
  });
  const period = shiftPeriod(currentPeriod(ctx.now(), company.timezone), -1);
  const reports = await createMonthlyReports(ctx, payload.company_id, period);
  return { plants: summary.plants, days: summary.metricDays, reports: reports.created };
});

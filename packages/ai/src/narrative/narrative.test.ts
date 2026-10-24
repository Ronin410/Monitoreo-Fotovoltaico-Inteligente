import { buildReportFacts, type ReportFacts } from '@pv/core';
import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '../mock.js';
import { LLMError } from '../provider.js';
import { generateNarrative, narrativeProblem } from './generate.js';
import { templateNarrative } from './template.js';

const facts: ReportFacts = buildReportFacts({
  period: '2026-09',
  clientName: 'Abarrotes El Sol',
  plants: [
    {
      name: 'Casa',
      capacityKwp: 8.2,
      firstDay: '2026-09-01',
      daysInPeriod: 30,
      days: [
        {
          date: '2026-09-01',
          energyKwh: 520,
          expectedTempKwh: 600,
          isValidDay: true,
          rainMm: 0,
          cloudCoverAvgPct: 10,
        },
        {
          date: '2026-09-02',
          energyKwh: 523.5,
          expectedTempKwh: 610,
          isValidDay: true,
          rainMm: 4,
          cloudCoverAvgPct: 80,
        },
      ],
      sunHours: 360,
      sunHoursWithData: 357,
    },
  ],
  energyPrevMonthKwh: 1120.2,
  energySameMonthLastYearKwh: null,
  tariffMxnPerKwh: 3.5,
  co2KgPerKwh: 0.438,
  avgMonthlyKwh: 1400,
  alertsOpened: 1,
  alertsResolved: 1,
  cleanings: 1,
  openIssues: [],
});

const words = (n: number) => Array.from({ length: n }, () => 'palabra').join(' ');

describe('narrativa del reporte (specs/08 §3)', () => {
  it('la plantilla usa solo cifras de facts, sin jerga, con la longitud pedida', () => {
    const text = templateNarrative(facts, 'Solar Demo');
    expect(narrativeProblem(text, facts)).toBeNull();
    expect(text).toContain('1,043.5 kWh');
    expect(text).toContain('6.8 % menos que el mes anterior');
    expect(text).toContain('$3,652.25 MXN');
    expect(text).toContain('una limpieza');
    expect(text).toContain('CO₂');
  });

  it('valida longitud, jerga y cifras inventadas', () => {
    expect(narrativeProblem('Muy corto.', facts)).toMatch(/entre 80 y 150/);
    expect(narrativeProblem(`${words(90)} con un PR de 0.86`, facts)).toMatch(/PR/);
    expect(narrativeProblem(`${words(90)} generó 2,000 kWh`, facts)).toMatch(/2,000/);
    expect(
      narrativeProblem(`${words(90)} generó 1,043.5 kWh y ahorró $3,652.25`, facts),
    ).toBeNull();
  });

  it('texto válido de la IA se usa; uno con cifra inventada dos veces cae a la plantilla', async () => {
    const good = `${words(85)} su sistema generó 1,043.5 kWh.`;
    const ok = await generateNarrative(
      new MockLLMProvider(() => good),
      'rapido',
      facts,
      'Solar Demo',
    );
    expect(ok).toMatchObject({ text: good, source: 'ai', failure: null });

    const provider = new MockLLMProvider(() => `${words(85)} generó 9,999 kWh.`);
    const bad = await generateNarrative(provider, 'rapido', facts, 'Solar Demo');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages[0]?.content).toContain('9,999');
    expect(bad).toMatchObject({ source: 'template', model: null });
    expect(bad.text).toBe(templateNarrative(facts, 'Solar Demo'));
    expect(bad.usage).toHaveLength(2);
  });

  it('proveedor caído: plantilla sin reintentar', async () => {
    const down = new MockLLMProvider(() => new LLMError('unavailable', 'No disponible'));
    expect(await generateNarrative(down, 'rapido', facts, 'X')).toMatchObject({
      source: 'template',
      failure: 'No disponible',
    });
    expect(down.requests).toHaveLength(1);
  });
});

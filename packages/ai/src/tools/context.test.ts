import { describe, expect, it } from 'vitest';
import { resolvePeriod, ToolError } from './context.js';
import { toolDefinitions } from './index.js';

describe('periodos de las herramientas', () => {
  const today = '2026-10-23';
  it.each([
    ['today', '2026-10-23', '2026-10-23'],
    ['yesterday', '2026-10-22', '2026-10-22'],
    ['last_7_days', '2026-10-16', '2026-10-22'],
    ['last_30_days', '2026-09-23', '2026-10-22'],
    ['this_month', '2026-10-01', '2026-10-23'],
    ['last_month', '2026-09-01', '2026-09-30'],
    ['this_year', '2026-01-01', '2026-10-23'],
  ] as const)('%s → %s a %s', (preset, from, to) => {
    expect(resolvePeriod({ preset }, today)).toMatchObject({ from, to });
  });

  it('el mes pasado en enero es diciembre del año anterior', () => {
    expect(resolvePeriod({ preset: 'last_month' }, '2027-01-05')).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
      days: 31,
    });
  });

  it('rango a la medida: máximo 400 días, fechas reales y en orden', () => {
    expect(resolvePeriod({ from: '2025-09-19', to: '2026-10-23' }, today).days).toBe(400);
    expect(() => resolvePeriod({ from: '2025-09-18', to: '2026-10-23' }, today)).toThrow(ToolError);
    expect(() => resolvePeriod({ from: '2026-02-30', to: '2026-03-01' }, today)).toThrow(
      'Fecha inválida: 2026-02-30',
    );
    expect(() => resolvePeriod({ from: '2026-10-02', to: '2026-10-01' }, today)).toThrow(ToolError);
  });

  it('las 11 herramientas tienen esquema de objeto y ninguna recibe company_id', () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(11);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
      expect(JSON.stringify(d.inputSchema)).not.toContain('company');
    }
  });
});

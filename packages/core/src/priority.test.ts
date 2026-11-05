import { describe, expect, it } from 'vitest';
import { isHighImpactPlant, ticketPriorityFor } from './priority.js';

describe('prioridad del ticket de una alerta', () => {
  const casa = { installationType: 'residential' as const, capacityKwp: 6 };

  it('en una casa sigue a la severidad', () => {
    expect(ticketPriorityFor('critical', casa)).toBe('high');
    expect(ticketPriorityFor('warning', casa)).toBe('normal');
    expect(ticketPriorityFor('info', casa)).toBe('low');
  });

  it('en un negocio, una industria o una planta grande sube un nivel', () => {
    for (const plant of [
      { installationType: 'commercial' as const, capacityKwp: 12 },
      { installationType: 'industrial' as const, capacityKwp: 500 },
      { installationType: 'residential' as const, capacityKwp: 30 },
    ]) {
      expect(isHighImpactPlant(plant)).toBe(true);
      expect(ticketPriorityFor('warning', plant)).toBe('high');
      expect(ticketPriorityFor('info', plant)).toBe('normal');
      expect(ticketPriorityFor('critical', plant)).toBe('high');
    }
    expect(isHighImpactPlant({ installationType: 'residential', capacityKwp: 29.9 })).toBe(false);
  });
});

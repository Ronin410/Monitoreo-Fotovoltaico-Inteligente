import { describe, expect, it } from 'vitest';
import { currentPeriod, isClosedPeriod, periodDays, plantInPeriod, shiftPeriod } from './period.js';

const TZ = 'America/Mazatlan';

describe('periodos del reporte', () => {
  it('días del mes, también en febrero bisiesto y diciembre', () => {
    expect(periodDays('2026-09')).toEqual({ first: '2026-09-01', last: '2026-09-30' });
    expect(periodDays('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(periodDays('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });

  it('desplaza meses cruzando años', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-09', -12)).toBe('2025-09');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('el mes en curso es el de la zona de la empresa', () => {
    // 1 de octubre 05:00 UTC = 30 de septiembre 22:00 en Mazatlán.
    const now = new Date('2026-10-01T05:00:00Z');
    expect(currentPeriod(now, TZ)).toBe('2026-09');
    expect(isClosedPeriod('2026-09', now, TZ)).toBe(false);
    expect(isClosedPeriod('2026-08', now, TZ)).toBe(true);
    expect(isClosedPeriod('2026-13', now, TZ)).toBe(false);
    expect(isClosedPeriod('2027-01', now, TZ)).toBe(false);
  });

  it('plantas activas en el periodo', () => {
    const base = {
      status: 'active',
      commissioningDate: null,
      createdAt: new Date('2026-05-01T12:00:00Z'),
      deletedAt: null,
    };
    expect(plantInPeriod(base, '2026-09', TZ)).toBe(true);
    // Alta el último día del mes (hora local).
    const lastDay = { ...base, commissioningDate: new Date('2026-10-01T05:00:00Z') };
    expect(plantInPeriod(lastDay, '2026-09', TZ)).toBe(true);
    expect(
      plantInPeriod({ ...base, createdAt: new Date('2026-10-02T12:00:00Z') }, '2026-09', TZ),
    ).toBe(false);
    expect(plantInPeriod({ ...base, status: 'decommissioned' }, '2026-09', TZ)).toBe(false);
    expect(
      plantInPeriod({ ...base, deletedAt: new Date('2026-08-20T00:00:00Z') }, '2026-09', TZ),
    ).toBe(false);
    expect(
      plantInPeriod({ ...base, deletedAt: new Date('2026-09-20T00:00:00Z') }, '2026-09', TZ),
    ).toBe(true);
  });
});

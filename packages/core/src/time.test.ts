import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  floorToHour,
  localDate,
  localHour,
  startOfLocalDay,
} from './time.js';

describe('zona horaria de la empresa', () => {
  it('hora y fecha local en America/Mazatlan (UTC−7)', () => {
    const t = new Date('2026-10-21T04:30:00Z');
    expect(localHour(t, 'America/Mazatlan')).toBe(21);
    expect(localDate(t, 'America/Mazatlan')).toBe('2026-10-20');
  });

  it('inicio del día local', () => {
    expect(startOfLocalDay('2026-10-20', 'America/Mazatlan').toISOString()).toBe(
      '2026-10-20T07:00:00.000Z',
    );
    expect(startOfLocalDay('2026-03-08', 'America/Tijuana').toISOString()).toBe(
      '2026-03-08T08:00:00.000Z',
    );
    // Después del cambio a horario de verano en Tijuana (UTC−7).
    expect(startOfLocalDay('2026-03-09', 'America/Tijuana').toISOString()).toBe(
      '2026-03-09T07:00:00.000Z',
    );
    expect(startOfLocalDay('2026-10-20', 'UTC').toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('redondea a la hora', () => {
    expect(floorToHour(new Date('2026-10-20T13:59:59.999Z')).toISOString()).toBe(
      '2026-10-20T13:00:00.000Z',
    );
  });
});

describe('fechas de calendario', () => {
  it('suma días y cuenta la diferencia', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-21')).toBe(20);
    expect(daysBetween('2026-10-21', '2026-10-01')).toBe(-20);
  });
});

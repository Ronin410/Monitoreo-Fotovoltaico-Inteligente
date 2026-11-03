import { describe, expect, it } from 'vitest';
import { durationStats, formatDuration, ticketDurations } from './tickets.js';

const at = (s: string) => new Date(`2026-11-02T${s}:00Z`);

describe('tiempos de tickets', () => {
  it('espera, trabajo y total de un ticket resuelto', () => {
    expect(
      ticketDurations(
        { createdAt: at('08:00'), startedAt: at('09:30'), resolvedAt: at('11:45') },
        at('12:00'),
      ),
    ).toEqual({ waitMinutes: 90, workMinutes: 135, totalMinutes: 225, elapsedMinutes: null });
  });

  it('en curso cuenta el tiempo transcurrido; sin iniciar no inventa el trabajo', () => {
    expect(
      ticketDurations(
        { createdAt: at('08:00'), startedAt: at('09:00'), resolvedAt: null },
        at('10:20'),
      ),
    ).toMatchObject({ workMinutes: null, totalMinutes: null, elapsedMinutes: 80 });
    expect(
      ticketDurations(
        { createdAt: at('08:00'), startedAt: null, resolvedAt: at('10:00') },
        at('11:00'),
      ),
    ).toEqual({ waitMinutes: null, workMinutes: null, totalMinutes: 120, elapsedMinutes: null });
  });

  it('promedio y mediana ignoran los no registrados', () => {
    expect(durationStats([60, null, 120, 30])).toEqual({
      count: 3,
      avgMinutes: 70,
      medianMinutes: 60,
    });
    expect(durationStats([60, 120])).toMatchObject({ medianMinutes: 90 });
    expect(durationStats([null])).toEqual({ count: 0, avgMinutes: null, medianMinutes: null });
  });

  it('formato legible', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(135)).toBe('2 h 15 min');
    expect(formatDuration(1440)).toBe('1 d');
    expect(formatDuration(1440 * 3 + 250)).toBe('3 d 4 h');
    expect(formatDuration(-5)).toBe('0 min');
  });
});

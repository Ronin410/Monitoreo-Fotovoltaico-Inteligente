import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { fieldErrors, invalidNumbers, numberOrNull, textOrNull } from './form';

describe('formularios', () => {
  it('errores de la API por campo (el primero de cada uno)', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Datos inválidos', [
      { path: 'capacity_kwp', message: 'Demasiado pequeño' },
      { path: 'capacity_kwp', message: 'otro' },
      { path: 'lat', message: 'Indica lat y lon juntas' },
    ]);
    expect(fieldErrors(err)).toEqual({
      capacity_kwp: 'Demasiado pequeño',
      lat: 'Indica lat y lon juntas',
    });
    expect(fieldErrors(new ApiError(409, 'X', 'y'))).toEqual({});
    expect(fieldErrors(new Error('x'))).toEqual({});
  });

  it('lee números (con coma decimal) y texto; detecta números inválidos', () => {
    const f = new FormData();
    f.set('a', ' 8,5 ');
    f.set('b', '');
    f.set('c', 'abc');
    f.set('t', '  hola ');
    expect(numberOrNull(f, 'a')).toBe(8.5);
    expect(numberOrNull(f, 'b')).toBeNull();
    expect(textOrNull(f, 't')).toBe('hola');
    expect(textOrNull(f, 'b')).toBeNull();
    expect(invalidNumbers(f, ['a', 'b', 'c'])).toEqual({
      c: 'Escribe un número (usa punto para decimales).',
    });
  });
});

describe('hora de la empresa', () => {
  it('lee el datetime-local en la zona de la empresa', async () => {
    const { zonedLocalToIso } = await import('@/lib/format');
    expect(zonedLocalToIso('2026-10-23T09:30', 'America/Mazatlan')).toBe(
      '2026-10-23T16:30:00.000Z',
    );
    expect(zonedLocalToIso('2026-10-23T09:30', 'UTC')).toBe('2026-10-23T09:30:00.000Z');
    // Ciudad de México sin horario de verano (UTC−6).
    expect(zonedLocalToIso('2026-07-01T12:00', 'America/Mexico_City')).toBe(
      '2026-07-01T18:00:00.000Z',
    );
  });
});

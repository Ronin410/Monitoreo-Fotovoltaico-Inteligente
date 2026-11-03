import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseCsv, parseLooseNumber } from './csv.js';

describe('CSV de importación', () => {
  it('lee comas, comillas, comillas dobles y saltos de línea dentro de comillas', () => {
    const t = parseCsv(
      'Cliente,Dirección,Notas\r\n"Pérez, Juan","Calle 1 ""A""","línea 1\nlínea 2"\n\n',
    );
    expect(t.delimiter).toBe(',');
    expect(t.headers).toEqual(['cliente', 'direccion', 'notas']);
    expect(t.rows).toEqual([['Pérez, Juan', 'Calle 1 "A"', 'línea 1\nlínea 2']]);
  });

  it('archivos de Excel en español: BOM y punto y coma', () => {
    const t = parseCsv('\uFEFFCódigo postal;Capacidad kWp\n80000;6,6\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['codigo_postal', 'capacidad_kwp']);
    expect(t.rows).toEqual([['80000', '6,6']]);
  });

  it('sin salto de línea final y renglones vacíos', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\n,\n1,2\n').rows).toEqual([['1', '2']]);
    expect(parseCsv('').rows).toEqual([]);
  });

  it('encabezados normalizados', () => {
    expect(normalizeHeader('  Puesta en marcha ')).toBe('puesta_en_marcha');
    expect(normalizeHeader('Teléfono')).toBe('telefono');
    expect(normalizeHeader('Correo-Reportes')).toBe('correo_reportes');
  });

  it('números escritos por personas', () => {
    expect(parseLooseNumber('6.6')).toBe(6.6);
    expect(parseLooseNumber('6,6')).toBe(6.6);
    expect(parseLooseNumber('1,234.5')).toBe(1234.5);
    expect(parseLooseNumber(' ')).toBeNull();
    expect(parseLooseNumber(undefined)).toBeNull();
    expect(parseLooseNumber('seis')).toBeNaN();
  });
});

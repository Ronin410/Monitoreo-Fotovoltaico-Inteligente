import { describe, expect, it } from 'vitest';
import { csvRow, normalizeHeader, parseCsv, parseLooseNumber } from './csv.js';

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

describe('csvRow (exportación)', () => {
  it('entrecomilla comas, comillas y saltos de línea', () => {
    expect(csvRow(['a,b', 'di "hola"', 'línea\nnueva', 'simple'])).toBe(
      '"a,b","di ""hola""","línea\nnueva",simple\r\n',
    );
  });

  it('da formato a fechas, nulos, números, booleanos, decimales y JSON', () => {
    const decimal = { toFixed: () => '', toString: () => '12.3400' };
    expect(
      csvRow([new Date('2026-11-03T12:00:00Z'), null, undefined, 4.5, 7n, true, decimal, { a: 1 }]),
    ).toBe('2026-11-03T12:00:00.000Z,,,4.5,7,true,12.3400,"{""a"":1}"\r\n');
  });

  it('neutraliza textos que Excel ejecutaría como fórmula, sin tocar números', () => {
    expect(csvRow(['=HYPERLINK("x")', '+52 667', '@SUM', '-5', -5, '-3.5'])).toBe(
      `"'=HYPERLINK(""x"")",'+52 667,'@SUM,-5,-5,-3.5\r\n`,
    );
  });

  it('se vuelve a leer igual con parseCsv', () => {
    const text = `${csvRow(['nombre', 'notas'])}${csvRow(['Planta 1', 'con "comillas", y coma'])}`;
    expect(parseCsv(text).rows).toEqual([['Planta 1', 'con "comillas", y coma']]);
  });
});

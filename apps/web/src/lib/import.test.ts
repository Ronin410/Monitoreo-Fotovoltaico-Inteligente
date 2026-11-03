import { describe, expect, it } from 'vitest';
import { readCsvFile } from './import';

describe('lectura del archivo CSV', () => {
  it('UTF-8 de "CSV UTF-8" de Excel', async () => {
    const blob = new Blob([new TextEncoder().encode('cliente\nMaría Núñez')]);
    expect(await readCsvFile(blob)).toBe('cliente\nMaría Núñez');
  });

  it('Windows-1252 de "CSV" normal de Excel', async () => {
    // "Peña" en Windows-1252: ñ = 0xF1 (no es UTF-8 válido).
    const blob = new Blob([new Uint8Array([0x50, 0x65, 0xf1, 0x61])]);
    expect(await readCsvFile(blob)).toBe('Peña');
  });
});

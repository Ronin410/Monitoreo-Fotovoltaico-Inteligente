import { describe, expect, it } from 'vitest';
import { mapTiles } from './map-tiles';

describe('mosaicos de los mapas', () => {
  it('sin configuración usa OpenStreetMap (pruebas)', () => {
    expect(mapTiles({}).url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(mapTiles({}).attribution).toContain('OpenStreetMap');
  });

  it('usa el proveedor comercial configurado con su atribución', () => {
    const t = mapTiles({
      url: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abc',
      attribution: '&copy; MapTiler &copy; OpenStreetMap',
    });
    expect(t.url).toContain('maptiler');
    expect(t.attribution).toBe('&copy; MapTiler &copy; OpenStreetMap');
    // Sin atribución propia, cita OpenStreetMap.
    expect(mapTiles({ url: 'https://x.example/{z}/{x}/{y}.png' }).attribution).toContain(
      'OpenStreetMap',
    );
  });

  it('ignora URLs inválidas o sin https', () => {
    for (const url of ['http://x.example/{z}/{x}/{y}.png', 'https://x.example/tiles.png', ' ']) {
      expect(mapTiles({ url }).url).toContain('tile.openstreetmap.org');
    }
  });
});

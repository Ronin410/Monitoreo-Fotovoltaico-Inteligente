import { describe, expect, it } from 'vitest';
import { detectImage, sanitizeSvg } from './images.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

describe('detectImage', () => {
  it('reconoce PNG, JPEG y SVG por su contenido', () => {
    expect(detectImage(PNG)?.contentType).toBe('image/png');
    expect(detectImage(JPEG)?.contentType).toBe('image/jpeg');
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.ext).toBe(
      'svg',
    );
    expect(
      detectImage(Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg width="10"></svg>'))?.ext,
    ).toBe('svg');
  });

  it('rechaza otros formatos', () => {
    expect(detectImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectImage(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('sanitizeSvg', () => {
  it('conserva el dibujo y quita scripts, eventos y recursos externos', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert('xss')</script>
      <style>@import url(https://evil.example.com/x.css);</style>
      <foreignObject><iframe src="https://evil.example.com"></iframe></foreignObject>
      <a href="javascript:alert(1)"><circle cx="5" cy="5" r="4" fill="#F59E0B" onclick="steal()"/></a>
      <image href="https://tracker.example.com/pixel.png"/>
      <use xlink:href="#forma"/>
      <rect id="forma" width="2" height="2" style="fill:url(https://evil.example.com/a)"/>
      <path d="M0 0L10 10" style="stroke:#000"/>
    </svg>`;
    const clean = sanitizeSvg(dirty) ?? '';
    expect(clean).toMatch(/^<svg/);
    expect(clean).toContain('<circle');
    expect(clean).toContain('fill="#F59E0B"');
    // DOMPurify elimina <use> (puede referenciar recursos externos), aun con referencia interna.
    expect(clean).not.toContain('<use');
    expect(clean).toContain('stroke:#000');
    for (const bad of [
      '<script',
      'onload',
      'onclick',
      'javascript:',
      '<style',
      '@import',
      'foreignObject',
      'iframe',
      'evil.example.com',
      'tracker.example.com',
    ]) {
      expect(clean, bad).not.toContain(bad);
    }
  });

  it('devuelve null si no queda un SVG', () => {
    expect(sanitizeSvg('<script>alert(1)</script>')).toBeNull();
    expect(sanitizeSvg('no es svg')).toBeNull();
  });
});

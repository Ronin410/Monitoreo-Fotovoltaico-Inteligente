import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Validación de logos (specs/02: solo PNG, JPG o SVG saneado, máximo 1 MB). El tipo se decide
// por el contenido, no por lo que declara el navegador.

export const MAX_LOGO_BYTES = 1024 * 1024;

export type ImageKind = { contentType: 'image/png' | 'image/jpeg' | 'image/svg+xml'; ext: string };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

const purify = createDOMPurify(new JSDOM('').window);

// Solo referencias internas (#id): nada de recursos externos que se descarguen al mostrar el logo.
purify.addHook('afterSanitizeAttributes', (node) => {
  for (const attr of ['href', 'xlink:href']) {
    const value = node.getAttribute(attr);
    if (value !== null && !value.trim().startsWith('#')) node.removeAttribute(attr);
  }
  const style = node.getAttribute('style');
  if (style !== null && /url\s*\(|expression\s*\(|@import/i.test(style)) {
    node.removeAttribute('style');
  }
});

/** Sanea un SVG; devuelve null si no queda un SVG válido. */
export function sanitizeSvg(svg: string): string | null {
  const clean = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'foreignObject', 'script'],
  });
  return /^\s*<svg[\s>]/i.test(clean) ? clean : null;
}

/** Detecta PNG o JPEG por sus bytes mágicos; SVG por su contenido de texto. */
export function detectImage(body: Buffer): ImageKind | null {
  if (body.subarray(0, PNG.length).equals(PNG)) return { contentType: 'image/png', ext: 'png' };
  if (body.subarray(0, JPEG.length).equals(JPEG)) return { contentType: 'image/jpeg', ext: 'jpg' };
  const head = body
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return { contentType: 'image/svg+xml', ext: 'svg' };
  }
  return null;
}

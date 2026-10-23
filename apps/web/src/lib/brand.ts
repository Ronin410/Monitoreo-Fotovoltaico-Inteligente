// Marca blanca (specs/09): el color de la empresa como acento. Solo se acepta #RRGGBB; el texto
// sobre el acento es blanco o casi negro según su luminancia, para que siempre se lea.

export const DEFAULT_BRAND = '#0E7490';

export function brandColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_BRAND;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores #RRGGBB. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto legible sobre el color de marca. */
export function onBrand(hex: string): '#FFFFFF' | '#14181F' {
  return contrast(hex, '#FFFFFF') >= contrast(hex, '#14181F') ? '#FFFFFF' : '#14181F';
}

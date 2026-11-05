import { describe, expect, it } from 'vitest';
import { contactLinks } from './contact';

describe('contacto de la página pública', () => {
  it('arma el correo con asunto y el WhatsApp con mensaje', () => {
    const links = contactLinks({ email: 'ventas@ejemplo.mx', whatsapp: '+52 667 123 4567' });
    expect(links.map((l) => l.kind)).toEqual(['email', 'whatsapp']);
    expect(links[0]?.href).toMatch(/^mailto:ventas@ejemplo\.mx\?subject=Demostraci%C3%B3n/);
    expect(links[1]?.href).toMatch(/^https:\/\/wa\.me\/526671234567\?text=Hola/);
  });

  it('ignora valores vacíos o mal escritos', () => {
    expect(contactLinks({})).toEqual([]);
    expect(contactLinks({ email: 'no-es-correo', whatsapp: '12-34' })).toEqual([]);
  });
});

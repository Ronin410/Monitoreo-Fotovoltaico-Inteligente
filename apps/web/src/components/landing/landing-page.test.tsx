import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { contactLinks } from '@/lib/contact';
import { LandingPage } from './landing-page';

// Página pública (docs/plan-lanzamiento.md 6.7): contenido verificable y contacto configurable.

describe('página pública', () => {
  it('presenta el producto, el estado real de cada marca y los enlaces legales', () => {
    render(<LandingPage contact={[]} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Monitoreo fotovoltaico/);
    for (const id of [
      'Beneficios',
      'Funciones',
      'Cómo funciona',
      'Marcas',
      'Seguridad',
      'Preguntas',
    ]) {
      expect(screen.getByRole('link', { name: id })).toBeTruthy();
    }
    const brands = screen.getByRole('region', { name: 'Marcas de inversor' });
    expect(within(brands).getByText('Victron Energy (VRM)').closest('li')?.textContent).toContain(
      'Disponible',
    );
    expect(within(brands).getByText('GoodWe (SEMS)').closest('li')?.textContent).toContain(
      'En integración',
    );
    expect(screen.getAllByRole('link', { name: 'Aviso de privacidad' }).length).toBeGreaterThan(0);
    // La vista previa se presenta como ejemplo, y no se prometen certificaciones.
    expect(screen.getByText('Datos de ejemplo')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/certificad|ISO 27001|SOC 2/i);
    // Sin contacto configurado no hay botones rotos.
    expect(screen.getByText('Los datos de contacto se publicarán pronto.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Solicitar una demostración/ })).toBeNull();
  });

  it('con contacto configurado ofrece correo y WhatsApp', () => {
    render(
      <LandingPage
        contact={contactLinks({ email: 'ventas@ejemplo.mx', whatsapp: '526671234567' })}
      />,
    );
    const demo = screen.getAllByRole('link', { name: /Solicitar una demostración/ });
    expect(demo[0]?.getAttribute('href')).toMatch(/^mailto:ventas@ejemplo\.mx/);
    const wa = screen.getAllByRole('link', { name: /Escribir por WhatsApp/ });
    expect(wa[0]?.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/526671234567/);
    expect(
      screen
        .getAllByRole('link', { name: /Ya tengo cuenta|Iniciar sesión/ })[0]
        ?.getAttribute('href'),
    ).toBe('/login');
  });
});

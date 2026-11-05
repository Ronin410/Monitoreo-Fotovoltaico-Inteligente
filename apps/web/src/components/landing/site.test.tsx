import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { contactLinks } from '@/lib/contact';
import { ContactPage, FeaturesPage, HomePage, HowItWorksPage, SecurityPage } from './pages';
import { SiteHeader } from './site-header';

// Sitio público (docs/plan-lanzamiento.md 6.7): menú, contenido verificable y contacto.

const pathname = '/inicio/funciones';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const CONTACT = contactLinks({ email: 'ventas@ejemplo.mx', whatsapp: '526671234567' });

describe('menú del sitio', () => {
  it('marca la sección actual y en celular abre y cierra el menú', async () => {
    render(<SiteHeader />);
    const desktop = screen.getAllByRole('navigation', { name: 'Secciones del sitio' })[0]!;
    expect(
      within(desktop).getByRole('link', { name: 'Funciones' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(desktop).getByRole('link', { name: 'Seguridad' }).getAttribute('href')).toBe(
      '/inicio/seguridad',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getAllByRole('navigation', { name: 'Secciones del sitio' })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    expect(screen.getAllByRole('navigation', { name: 'Secciones del sitio' })).toHaveLength(1);
  });
});

describe('páginas del sitio', () => {
  it.each([
    ['inicio', HomePage],
    ['funciones', FeaturesPage],
    ['cómo funciona', HowItWorksPage],
    ['seguridad', SecurityPage],
    ['contacto', ContactPage],
  ])('%s: un solo título principal y sin promesas que no se cumplen', (_name, Page) => {
    render(<Page contact={CONTACT} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(
      /certificad|ISO 27001|SOC 2|\$\s?\d+\s?(al mes|\/mes)/i,
    );
  });

  it('las ilustraciones dicen que son ejemplos', () => {
    render(<FeaturesPage contact={CONTACT} />);
    expect(screen.getAllByText('Ilustración con datos de ejemplo')).toHaveLength(4);
  });

  it('cómo funciona muestra el estado real de cada marca', () => {
    render(<HowItWorksPage contact={CONTACT} />);
    const brands = screen.getByRole('region', { name: 'Marcas de inversor' });
    expect(within(brands).getByText('Victron Energy').closest('li')?.textContent).toContain(
      'Disponible',
    );
    expect(within(brands).getByText('GoodWe').closest('li')?.textContent).toContain(
      'En integración',
    );
  });

  it('contacto: correo y WhatsApp configurados, y explica el nombre', async () => {
    render(<ContactPage contact={CONTACT} />);
    const demo = screen.getAllByRole('link', { name: /Solicitar una demostración/ })[0];
    expect(demo?.getAttribute('href')).toMatch(/^mailto:ventas@ejemplo\.mx/);
    const wa = screen.getAllByRole('link', { name: /Escribir por WhatsApp/ })[0];
    expect(wa?.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/526671234567/);
    await userEvent.click(screen.getByText('¿Qué significa PV-IoT?'));
    expect(screen.getByText(/Internet de las cosas/)).toBeTruthy();
  });

  it('sin contacto configurado no muestra botones rotos', () => {
    render(<HomePage contact={[]} />);
    expect(screen.queryByRole('link', { name: /Solicitar una demostración/ })).toBeNull();
    expect(
      screen.getAllByText('Los datos de contacto se publicarán pronto.').length,
    ).toBeGreaterThan(0);
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { contrast } from '@/lib/brand';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/tickets/123' }));
const logout = vi.fn(async () => {});
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ logout }) }));

const company = {
  id: '1b9f6f2e-7a43-4c39-9b8e-0f6a1c2d3e4f',
  name: 'Solar Demo Culiacán',
  slug: 'solar-demo',
  logo_url: null,
  brand_color: '#FDE047',
  timezone: 'America/Mazatlan',
};
const user = (role: 'technician' | 'company_admin') => ({
  id: '0b9f6f2e-7a43-4c39-9b8e-0f6a1c2d3e4f',
  email: 't@ej.com',
  name: 'Tomás Técnico',
  role,
});

describe('AppShell', () => {
  it('el técnico solo ve "Mis tickets", marcado como página actual', () => {
    render(
      <AppShell user={user('technician')} company={company}>
        contenido
      </AppShell>,
    );
    const navs = screen.getAllByRole('navigation', { name: 'Principal' });
    const links = within(navs[0]!).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Mis tickets']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByText('Técnico').length).toBeGreaterThan(0);
  });

  it('el admin ve todo el menú', () => {
    render(
      <AppShell user={user('company_admin')} company={company}>
        contenido
      </AppShell>,
    );
    const links = within(screen.getAllByRole('navigation', { name: 'Principal' })[0]!).getAllByRole(
      'link',
    );
    expect(links).toHaveLength(8);
  });

  it('aplica la marca de la empresa con texto legible y cierra sesión', async () => {
    const { container } = render(
      <AppShell user={user('technician')} company={company}>
        contenido
      </AppShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--brand')).toBe('#FDE047');
    expect(root.style.getPropertyValue('--on-brand')).toBe('#14181F');
    // Amarillo como texto sobre blanco se oscurece hasta 4.5:1; sobre fondo oscuro queda igual.
    expect(
      contrast(root.style.getPropertyValue('--brand-text-light'), '#FFFFFF'),
    ).toBeGreaterThanOrEqual(4.5);
    expect(root.style.getPropertyValue('--brand-text-dark')).toBe('#FDE047');
    expect(screen.getAllByText('Solar Demo Culiacán').length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Cerrar sesión' })[0]!);
    expect(logout).toHaveBeenCalled();
  });

  it('en el celular el menú se abre y se cierra con un botón accesible', async () => {
    render(
      <AppShell user={user('technician')} company={company}>
        contenido
      </AppShell>,
    );
    const toggle = screen.getByRole('button', { name: 'Abrir menú' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Cerrar menú' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.getElementById('menu-movil')).not.toBeNull();
  });
});

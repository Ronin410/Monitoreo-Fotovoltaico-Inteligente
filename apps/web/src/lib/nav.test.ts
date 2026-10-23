import { describe, expect, it } from 'vitest';
import { brandColor, brandText, contrast, onBrand } from './brand';
import { canVisit, homeFor, navItems, safeNext } from './nav';

const labels = (role: Parameters<typeof navItems>[0]) => navItems(role).map((i) => i.label);

describe('navegación por rol (specs/09)', () => {
  it('cada rol ve su menú', () => {
    expect(labels('company_admin')).toEqual([
      'Tablero',
      'Plantas',
      'Clientes',
      'Alertas',
      'Tickets',
      'Asistente IA',
      'Reportes',
      'Configuración',
    ]);
    expect(labels('operator')).toEqual([
      'Tablero',
      'Plantas',
      'Clientes',
      'Alertas',
      'Tickets',
      'Asistente IA',
      'Reportes',
    ]);
    expect(labels('technician')).toEqual(['Mis tickets']);
    expect(labels('superadmin')).toEqual(['Empresas', 'Salud del sistema']);
  });

  it('inicio por rol y rutas permitidas', () => {
    expect(homeFor('operator')).toBe('/');
    expect(homeFor('technician')).toBe('/tickets');
    expect(homeFor('superadmin')).toBe('/admin/companies');
    expect(canVisit('technician', '/tickets/abc')).toBe(true);
    expect(canVisit('technician', '/')).toBe(false);
    expect(canVisit('technician', '/plants')).toBe(false);
    expect(canVisit('operator', '/settings')).toBe(false);
    expect(canVisit('company_admin', '/settings')).toBe(true);
    expect(canVisit('operator', '/plantsx')).toBe(false);
    expect(canVisit('superadmin', '/alerts')).toBe(false);
  });

  it('?next= solo acepta rutas internas', () => {
    expect(safeNext('/alerts/1')).toBe('/alerts/1');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('marca blanca', () => {
  it('solo acepta #RRGGBB', () => {
    expect(brandColor('#7C3AED')).toBe('#7C3AED');
    expect(brandColor('red')).toBe('#0E7490');
    expect(brandColor('#FFF')).toBe('#0E7490');
    expect(brandColor(null)).toBe('#0E7490');
  });

  it('elige texto legible sobre el acento', () => {
    expect(onBrand('#0E7490')).toBe('#FFFFFF');
    expect(onBrand('#FDE047')).toBe('#14181F');
    for (const c of ['#0E7490', '#FDE047', '#F59E0B', '#7C3AED', '#000000', '#FFFFFF']) {
      expect(contrast(c, onBrand(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el color de marca como texto llega a 4.5:1 en modo claro y oscuro', () => {
    for (const c of ['#0E7490', '#FDE047', '#F59E0B', '#7C3AED', '#000000', '#FFFFFF', '#1D4ED8']) {
      expect(contrast(brandText(c, '#FFFFFF'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(brandText(c, '#0F172A'), '#0F172A')).toBeGreaterThanOrEqual(4.5);
    }
    // Si ya se lee, no cambia.
    expect(brandText('#0E7490', '#FFFFFF')).toBe('#0E7490');
  });
});

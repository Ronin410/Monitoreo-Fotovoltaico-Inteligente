import { can } from '@pv/core';
import type { UserRole } from './schemas';

// Navegación según rol (specs/09 §Navegación), derivada de la matriz de permisos de specs/02.

export type NavIcon =
  | 'dashboard'
  | 'plants'
  | 'clients'
  | 'alerts'
  | 'tickets'
  | 'assistant'
  | 'reports'
  | 'settings'
  | 'companies'
  | 'health';

export type NavItem = { href: string; label: string; icon: NavIcon };

export function navItems(role: UserRole): NavItem[] {
  if (role === 'superadmin') {
    return [
      { href: '/admin/companies', label: 'Empresas', icon: 'companies' },
      { href: '/admin/health', label: 'Salud del sistema', icon: 'health' },
    ];
  }
  // El técnico solo trabaja con sus tickets (y la planta de cada uno).
  if (!can(role, 'fleet:read')) {
    return [{ href: '/tickets', label: 'Mis tickets', icon: 'tickets' }];
  }
  const items: NavItem[] = [
    { href: '/', label: 'Tablero', icon: 'dashboard' },
    { href: '/plants', label: 'Plantas', icon: 'plants' },
  ];
  if (can(role, 'inventory:manage'))
    items.push({ href: '/clients', label: 'Clientes', icon: 'clients' });
  items.push({ href: '/alerts', label: 'Alertas', icon: 'alerts' });
  items.push({ href: '/tickets', label: 'Tickets', icon: 'tickets' });
  if (can(role, 'ai:use'))
    items.push({ href: '/assistant', label: 'Asistente IA', icon: 'assistant' });
  if (can(role, 'reports:manage'))
    items.push({ href: '/reports', label: 'Reportes', icon: 'reports' });
  if (can(role, 'company:configure')) {
    items.push({ href: '/settings', label: 'Configuración', icon: 'settings' });
  }
  return items;
}

/** Página de inicio de cada rol. */
export function homeFor(role: UserRole): string {
  return navItems(role)[0]?.href ?? '/';
}

/** ¿El rol puede abrir esta ruta? (la API vuelve a verificar cada petición). */
export function canVisit(role: UserRole, pathname: string): boolean {
  return navItems(role).some((item) =>
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

/** Solo una ruta interna: evita redirecciones abiertas con ?next=. */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : null;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  company_admin: 'Administrador',
  operator: 'Operador',
  technician: 'Técnico',
};

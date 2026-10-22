import type { UserRole } from './types.js';

// Matriz de autorización por rol (specs/02 §Autorización por rol). Compartida por la API
// (middleware) y el frontend (navegación según rol).

export const PERMISSIONS = {
  /** Crear y suspender empresas. */
  'companies:manage': ['superadmin'],
  /** Ver los datos de la empresa propia (GET /company: todos los roles de la empresa). */
  'company:read': ['company_admin', 'operator', 'technician'],
  /** Configurar empresa: marca, umbrales, tarifas. */
  'company:configure': ['company_admin'],
  /** Gestionar usuarios de la empresa (invitar, cambiar rol, desactivar). */
  'users:manage': ['company_admin'],
  /** CRUD de clientes y plantas. */
  'inventory:manage': ['company_admin', 'operator'],
  /** Capturar o reemplazar credenciales de inversor. */
  'credentials:write': ['company_admin', 'operator'],
  /**
   * Ver tablero, plantas y alertas de toda la flota. El técnico no lo tiene: solo ve las
   * plantas de sus tickets (se verifica por recurso en las rutas de plantas y tickets).
   */
  'fleet:read': ['company_admin', 'operator'],
  /** Gestionar alertas y crear o asignar tickets. */
  'alerts:manage': ['company_admin', 'operator'],
  /** Actualizar tickets (el técnico solo los asignados a él; se verifica por recurso). */
  'tickets:update': ['company_admin', 'operator', 'technician'],
  /** Usar el asistente IA. */
  'ai:use': ['company_admin', 'operator'],
  /** Generar y enviar reportes. */
  'reports:manage': ['company_admin', 'operator'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

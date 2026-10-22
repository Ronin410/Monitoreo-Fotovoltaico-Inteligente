import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type Permission } from './permissions.js';
import { USER_ROLES, type UserRole } from './types.js';

// Transcripción de la tabla de specs/02 (✅ = puede; "solo …" = permiso limitado por recurso).
const MATRIX: Record<Permission, Record<UserRole, boolean>> = {
  'companies:manage': {
    superadmin: true,
    company_admin: false,
    operator: false,
    technician: false,
  },
  'company:read': { superadmin: false, company_admin: true, operator: true, technician: true },
  'company:configure': {
    superadmin: false,
    company_admin: true,
    operator: false,
    technician: false,
  },
  'users:manage': { superadmin: false, company_admin: true, operator: false, technician: false },
  'inventory:manage': { superadmin: false, company_admin: true, operator: true, technician: false },
  'credentials:write': {
    superadmin: false,
    company_admin: true,
    operator: true,
    technician: false,
  },
  'fleet:read': { superadmin: false, company_admin: true, operator: true, technician: false },
  'alerts:manage': { superadmin: false, company_admin: true, operator: true, technician: false },
  'tickets:update': { superadmin: false, company_admin: true, operator: true, technician: true },
  'ai:use': { superadmin: false, company_admin: true, operator: true, technician: false },
  'reports:manage': { superadmin: false, company_admin: true, operator: true, technician: false },
};

describe('matriz de permisos (specs/02)', () => {
  it('cubre todos los permisos definidos', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  for (const [permission, byRole] of Object.entries(MATRIX)) {
    for (const role of USER_ROLES) {
      const expected = byRole[role];
      it(`${role} ${expected ? 'puede' : 'no puede'} ${permission}`, () => {
        expect(can(role, permission as Permission)).toBe(expected);
      });
    }
  }

  it('el superadmin no tiene permisos sobre datos operativos de las empresas', () => {
    const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can('superadmin', p));
    expect(granted).toEqual(['companies:manage']);
  });
});

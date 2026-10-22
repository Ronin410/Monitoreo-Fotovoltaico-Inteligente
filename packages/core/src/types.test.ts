import { describe, expect, it } from 'vitest';
import { INVERTER_BRANDS, USER_ROLES } from './index.js';

describe('tipos de dominio', () => {
  it('define los roles de la matriz de 02', () => {
    expect(USER_ROLES).toEqual(['superadmin', 'company_admin', 'operator', 'technician']);
  });

  it('incluye el simulador como marca de inversor', () => {
    expect(INVERTER_BRANDS).toContain('simulator');
  });
});

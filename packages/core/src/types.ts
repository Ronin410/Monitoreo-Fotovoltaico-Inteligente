// Tipos de dominio compartidos (ver specs/03-modelo-de-datos.md).

export const USER_ROLES = ['superadmin', 'company_admin', 'operator', 'technician'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const INVERTER_BRANDS = [
  'simulator',
  'goodwe',
  'huawei',
  'fronius',
  'enphase',
  'other',
] as const;
export type InverterBrand = (typeof INVERTER_BRANDS)[number];

export const PLANT_DAILY_STATUSES = ['ok', 'warning', 'critical', 'offline', 'no_data'] as const;
export type PlantDailyStatus = (typeof PLANT_DAILY_STATUSES)[number];

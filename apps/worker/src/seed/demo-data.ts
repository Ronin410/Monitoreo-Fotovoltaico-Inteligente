// Datos de la semilla de demo (specs/04 §4). Coordenadas aproximadas dentro de cada colonia,
// nunca domicilios reales. ⚠️ Códigos postales y coordenadas pendientes de validar por el PO
// (specs/PREGUNTAS.md #99).

export type Colonia = { name: string; postalCode: string; lat: number; lon: number };

export const CULIACAN_COLONIAS: Colonia[] = [
  { name: 'Centro', postalCode: '80000', lat: 24.8069, lon: -107.3938 },
  { name: 'Las Quintas', postalCode: '80060', lat: 24.8135, lon: -107.4055 },
  { name: 'Tres Ríos', postalCode: '80020', lat: 24.8152, lon: -107.3855 },
  { name: 'Chapultepec', postalCode: '80040', lat: 24.7985, lon: -107.4015 },
  { name: 'Guadalupe', postalCode: '80220', lat: 24.7925, lon: -107.3895 },
  { name: 'Infonavit Humaya', postalCode: '80020', lat: 24.8295, lon: -107.3985 },
  { name: 'Villa Universidad', postalCode: '80010', lat: 24.8265, lon: -107.3755 },
];

export const MAZATLAN_COLONIAS: Colonia[] = [
  { name: 'Centro', postalCode: '82000', lat: 23.2005, lon: -106.4205 },
  { name: 'Lomas de Mazatlán', postalCode: '82110', lat: 23.2335, lon: -106.4295 },
];

/** Qué le pasa a la planta en la demo (se traduce a escenarios del simulador y a fechas). */
export type DemoScenario =
  | { kind: 'normal' }
  /** Suciedad acumulada hoy, en % (el umbral por omisión es 12 %). */
  | { kind: 'soiling'; lossTodayPct: number }
  | { kind: 'string_failure'; daysAgo: number; lossPct: number }
  /** Sin comunicación desde las 09:00 locales de hace `daysAgo` días. */
  | { kind: 'offline'; daysAgo: number }
  /** Sombra (p. ej. un árbol que creció) desde hace `daysAgo` días. */
  | { kind: 'shading'; daysAgo: number; localHours: number[]; lossPct: number }
  /** Instalada hace `daysAgo` días (sin línea base propia suficiente). */
  | { kind: 'new'; daysAgo: number };

export type DemoPlant = {
  kind: 'residential' | 'commercial';
  capacityKwp: number;
  scenario: DemoScenario;
};

const normal = (kind: DemoPlant['kind'], capacityKwp: number): DemoPlant => ({
  kind,
  capacityKwp,
  scenario: { kind: 'normal' },
});

/** Empresa A: 25 plantas (15 normales y 10 con escenario). */
export const COMPANY_A_PLANTS: DemoPlant[] = [
  normal('residential', 3.3),
  normal('residential', 4.4),
  normal('residential', 5.5),
  normal('residential', 6.6),
  normal('residential', 7.15),
  normal('residential', 8.25),
  normal('residential', 9.9),
  normal('residential', 11),
  normal('residential', 12),
  normal('residential', 5),
  normal('commercial', 20),
  normal('commercial', 35),
  normal('commercial', 50),
  normal('commercial', 75),
  normal('commercial', 100),
  { kind: 'residential', capacityKwp: 6, scenario: { kind: 'soiling', lossTodayPct: 3 } },
  { kind: 'residential', capacityKwp: 8, scenario: { kind: 'soiling', lossTodayPct: 7 } },
  { kind: 'commercial', capacityKwp: 30, scenario: { kind: 'soiling', lossTodayPct: 10.5 } },
  { kind: 'commercial', capacityKwp: 45, scenario: { kind: 'soiling', lossTodayPct: 16 } },
  {
    kind: 'residential',
    capacityKwp: 9,
    scenario: { kind: 'string_failure', daysAgo: 3, lossPct: 33 },
  },
  {
    kind: 'commercial',
    capacityKwp: 60,
    scenario: { kind: 'string_failure', daysAgo: 25, lossPct: 33 },
  },
  { kind: 'residential', capacityKwp: 7, scenario: { kind: 'offline', daysAgo: 2 } },
  {
    kind: 'residential',
    capacityKwp: 5.5,
    scenario: { kind: 'shading', daysAgo: 30, localHours: [15, 16, 17], lossPct: 45 },
  },
  { kind: 'residential', capacityKwp: 4.4, scenario: { kind: 'new', daysAgo: 9 } },
  { kind: 'commercial', capacityKwp: 25, scenario: { kind: 'new', daysAgo: 6 } },
];

/** Empresa B: 5 plantas normales en Mazatlán. */
export const COMPANY_B_PLANTS: DemoPlant[] = [
  normal('residential', 4.4),
  normal('residential', 6.6),
  normal('residential', 8.8),
  normal('commercial', 30),
  normal('commercial', 50),
];

export const CLIENT_FIRST_NAMES = [
  'María',
  'José',
  'Guadalupe',
  'Juan',
  'Ana',
  'Luis',
  'Rosa',
  'Carlos',
  'Patricia',
  'Jorge',
  'Laura',
  'Miguel',
  'Sofía',
  'Ricardo',
  'Elena',
  'Fernando',
  'Lucía',
  'Arturo',
  'Teresa',
  'Héctor',
];

export const CLIENT_LAST_NAMES = [
  'López',
  'García',
  'Félix',
  'Ochoa',
  'Castro',
  'Valenzuela',
  'Quintero',
  'Zazueta',
  'Inzunza',
  'Rodríguez',
];

export const BUSINESS_NAMES = [
  'Abarrotes El Sol',
  'Taller Mecánico Humaya',
  'Clínica Dental Tres Ríos',
  'Purificadora La Quinta',
  'Hielera del Valle',
  'Bodega Agrícola Culiacán',
  'Escuela Primaria Particular Las Palmas',
  'Restaurante Mariscos El Malecón',
];

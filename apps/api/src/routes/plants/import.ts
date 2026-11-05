import {
  normalizeHeader,
  parseCsv,
  parseLooseNumber,
  type InstallationType,
  type InverterBrand,
} from '@pv/core';
import type { z } from 'zod';
import { createClientBody } from '../clients/schemas.js';
import { createPlantBody } from './schemas.js';

// Importación masiva de clientes y plantas desde CSV (docs/plan-lanzamiento.md 6.4). Cada renglón
// es una planta con los datos de su cliente; los clientes se agrupan por nombre. Valida con los
// mismos esquemas que los formularios y devuelve los errores por renglón y columna.

export const MAX_IMPORT_ROWS = 2000;

/** Columna del CSV → campo del cliente o de la planta. */
const CLIENT_COLUMNS = {
  cliente: 'name',
  contacto: 'contact_name',
  telefono: 'phone',
  correo: 'email',
  direccion: 'address',
  colonia: 'colonia',
  codigo_postal: 'postal_code',
  ciudad: 'city',
  estado: 'state',
  latitud: 'lat',
  longitud: 'lon',
  tarifa_cfe: 'cfe_tariff',
  precio_kwh: 'tariff_mxn_per_kwh',
  consumo_mensual_kwh: 'avg_monthly_kwh',
  recibo_mensual_mxn: 'avg_monthly_bill_mxn',
  correo_reportes: 'report_email',
} as const;

const PLANT_COLUMNS = {
  planta: 'name',
  capacidad_kwp: 'capacity_kwp',
  puesta_en_marcha: 'commissioning_date',
  marca_inversor: 'inverter_brand',
  modelo_inversor: 'inverter_model',
  serie_inversor: 'inverter_serial',
  modelo_panel: 'panel_model',
  numero_paneles: 'panel_count',
  inclinacion: 'tilt_deg',
  orientacion: 'azimuth_deg',
  latitud_planta: 'lat',
  longitud_planta: 'lon',
  tipo_instalacion: 'installation_type',
  con_bateria: 'has_battery',
  limite_inyeccion: 'export_limited',
} as const;

export const IMPORT_COLUMNS = [...Object.keys(CLIENT_COLUMNS), ...Object.keys(PLANT_COLUMNS)];
const REQUIRED = ['cliente', 'planta', 'capacidad_kwp', 'marca_inversor'];

const NUMERIC = new Set([
  'latitud',
  'longitud',
  'precio_kwh',
  'consumo_mensual_kwh',
  'recibo_mensual_mxn',
  'capacidad_kwp',
  'numero_paneles',
  'inclinacion',
  'orientacion',
  'latitud_planta',
  'longitud_planta',
]);

/** Columnas de sí/no (specs/06 §2.4). Vacío es "no". */
const BOOLEAN = new Set(['con_bateria', 'limite_inyeccion']);
const YES = new Set(['si', 'yes', 'x', '1', 'true', 'verdadero']);
const NO = new Set(['no', '0', 'false', 'falso']);

/** "Residencial", "casa", "negocio"… → tipo de instalación. */
const INSTALLATION: Record<string, InstallationType> = {
  residencial: 'residential',
  casa: 'residential',
  domestica: 'residential',
  hogar: 'residential',
  comercial: 'commercial',
  negocio: 'commercial',
  industrial: 'industrial',
  industria: 'industrial',
};

const BRANDS: Record<string, InverterBrand> = {
  goodwe: 'goodwe',
  growatt: 'growatt',
  victron: 'victron',
  victron_energy: 'victron',
  huawei: 'huawei',
  fronius: 'fronius',
  enphase: 'enphase',
  otra: 'other',
  otra_marca: 'other',
  other: 'other',
  simulador: 'simulator',
  simulador_demo: 'simulator',
  simulator: 'simulator',
};

export type ImportError = { row: number; column: string | null; message: string };

export type ImportClient = {
  key: string;
  row: number;
  data: z.output<typeof createClientBody> | null;
};
export type ImportPlant = {
  row: number;
  clientKey: string;
  data: z.output<typeof createPlantBody>;
};

export type ImportPlan = {
  rows: number;
  clients: ImportClient[];
  plants: ImportPlant[];
  errors: ImportError[];
  ignoredColumns: string[];
};

/** Clave para agrupar clientes y detectar plantas repetidas: sin mayúsculas, acentos ni espacios. */
export const nameKey = (s: string) => normalizeHeader(s);

/** "2025-03-10" o "10/03/2025" (día/mes/año, como Excel en español) → "2025-03-10". */
function isoDate(raw: string): string {
  const v = raw.trim();
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2]?.padStart(2, '0')}-${dmy[1]?.padStart(2, '0')}` : v;
}

const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Valida el CSV. `existingClients` (clave → id) y `existingPlants` (clave de cliente → claves de
 * planta) vienen de la base: un cliente existente no se modifica y una planta ya registrada con el
 * mismo nombre para el mismo cliente se reporta como repetida.
 */
export function planImport(
  csv: string,
  existingClients: Map<string, string>,
  existingPlants: Map<string, Set<string>>,
  options: { simulatorEnabled: boolean },
): ImportPlan {
  const table = parseCsv(csv);
  const errors: ImportError[] = [];
  const known = new Set(IMPORT_COLUMNS);
  const ignoredColumns = table.headers.filter((h) => h && !known.has(h));
  const missing = REQUIRED.filter((c) => !table.headers.includes(c));
  if (missing.length) {
    errors.push({ row: 1, column: null, message: `Faltan columnas: ${missing.join(', ')}` });
    return { rows: table.rows.length, clients: [], plants: [], errors, ignoredColumns };
  }
  if (table.rows.length === 0) {
    errors.push({ row: 1, column: null, message: 'El archivo no tiene renglones de datos' });
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    errors.push({
      row: 1,
      column: null,
      message: `Máximo ${MAX_IMPORT_ROWS} renglones por archivo; divídalo en varios`,
    });
    return { rows: table.rows.length, clients: [], plants: [], errors, ignoredColumns };
  }

  const clients = new Map<string, ImportClient>();
  const plants: ImportPlant[] = [];
  const seenPlants = new Set<string>();

  table.rows.forEach((cells, i) => {
    const row = i + 2; // el renglón 1 son los encabezados
    const get = (col: string) => {
      const idx = table.headers.indexOf(col);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const fail = (column: string | null, message: string) => errors.push({ row, column, message });

    // Convierte los valores de un grupo de columnas; un número ilegible es error de esa columna.
    const read = (columns: Record<string, string>) => {
      const out: Record<string, unknown> = {};
      let ok = true;
      for (const [col, field] of Object.entries(columns)) {
        const raw = get(col);
        if (raw === '') continue;
        if (NUMERIC.has(col)) {
          const n = parseLooseNumber(raw);
          if (Number.isNaN(n)) {
            fail(col, `"${raw}" no es un número`);
            ok = false;
          } else out[field] = n;
        } else if (BOOLEAN.has(col)) {
          const v = normalizeHeader(raw);
          if (YES.has(v)) out[field] = true;
          else if (NO.has(v)) out[field] = false;
          else {
            fail(col, `"${raw}" no es sí o no`);
            ok = false;
          }
        } else if (col === 'tipo_instalacion') {
          const type = INSTALLATION[normalizeHeader(raw)];
          if (type) out[field] = type;
          else {
            fail(col, `"${raw}" no es residencial, comercial ni industrial`);
            ok = false;
          }
        } else if (col === 'puesta_en_marcha') out[field] = isoDate(raw);
        else out[field] = raw;
      }
      return ok ? out : null;
    };
    // Primer error de zod de cada campo, en el nombre de la columna del CSV.
    const report = (issues: z.core.$ZodIssue[], columns: Record<string, string>) => {
      const byField = Object.fromEntries(Object.entries(columns).map(([c, f]) => [f, c]));
      const seen = new Set<string>();
      for (const issue of issues) {
        const field = String(issue.path[0] ?? '');
        if (seen.has(field)) continue;
        seen.add(field);
        fail(byField[field] ?? null, issue.message);
      }
    };

    // Cliente: se valida completo solo la primera vez que aparece y si no existe ya.
    const clientName = get('cliente');
    if (!clientName) {
      fail('cliente', 'Falta el nombre del cliente');
      return;
    }
    const key = nameKey(clientName);
    if (!clients.has(key)) {
      if (existingClients.has(key)) {
        clients.set(key, { key, row, data: null });
      } else {
        const values = read(CLIENT_COLUMNS);
        const parsed = values && createClientBody.safeParse(values);
        if (parsed && !parsed.success) report(parsed.error.issues, CLIENT_COLUMNS);
        clients.set(key, { key, row, data: parsed?.success ? parsed.data : null });
      }
    }

    // Planta.
    const values = read(PLANT_COLUMNS);
    if (!values) return;
    const brandRaw = get('marca_inversor');
    const brand = BRANDS[normalizeHeader(brandRaw)];
    if (!brand) {
      fail(
        'marca_inversor',
        `Marca "${brandRaw}" no reconocida (use GoodWe, Growatt, Victron, Huawei, Fronius, Enphase u Otra)`,
      );
      return;
    }
    if (brand === 'simulator' && !options.simulatorEnabled) {
      fail('marca_inversor', 'El inversor simulado solo está disponible en ambientes de prueba');
      return;
    }
    const parsed = createPlantBody.safeParse({
      ...values,
      inverter_brand: brand,
      client_id: PLACEHOLDER_ID,
    });
    if (!parsed.success) {
      report(parsed.error.issues, PLANT_COLUMNS);
      return;
    }
    const plantKey = `${key}/${nameKey(parsed.data.name)}`;
    if (seenPlants.has(plantKey)) {
      fail(
        'planta',
        `La planta "${parsed.data.name}" está repetida en el archivo para este cliente`,
      );
      return;
    }
    if (existingPlants.get(key)?.has(nameKey(parsed.data.name))) {
      fail('planta', `El cliente ya tiene una planta llamada "${parsed.data.name}"`);
      return;
    }
    seenPlants.add(plantKey);
    plants.push({ row, clientKey: key, data: parsed.data });
  });

  return {
    rows: table.rows.length,
    clients: [...clients.values()],
    plants,
    errors,
    ignoredColumns,
  };
}

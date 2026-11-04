import { z } from 'zod';

// Importación masiva de plantas (espejo de apps/api/src/routes/plants/import.ts).

export const importResult = z.object({
  rows: z.number(),
  clients_new: z.number(),
  clients_existing: z.number(),
  plants_new: z.number(),
  imported: z.boolean(),
  errors: z.array(
    z.object({ row: z.number(), column: z.string().nullable(), message: z.string() }),
  ),
  ignored_columns: z.array(z.string()),
});
export type ImportResult = z.infer<typeof importResult>;

export const TEMPLATE_URL = '/plantilla-importacion-plantas.csv';

/** Guía de columnas: nombre, si es obligatoria y qué poner. */
export const IMPORT_GUIDE: { column: string; required: string; help: string }[] = [
  {
    column: 'cliente',
    required: 'Sí',
    help: 'Nombre o razón social. Las filas con el mismo cliente se agrupan; si ya existe en la plataforma, la planta se le agrega.',
  },
  {
    column: 'direccion, colonia, codigo_postal, latitud, longitud',
    required: 'Cliente nuevo',
    help: 'Domicilio y ubicación del cliente (código postal de 5 dígitos). Basta llenarlos en su primera fila.',
  },
  {
    column: 'contacto, telefono, correo, ciudad, estado',
    required: 'No',
    help: 'Datos de contacto del cliente.',
  },
  {
    column: 'tarifa_cfe, precio_kwh, consumo_mensual_kwh, recibo_mensual_mxn',
    required: 'No',
    help: 'Del recibo de CFE (por ejemplo 1F, PDBT). Sirven para el ahorro estimado.',
  },
  {
    column: 'correo_reportes',
    required: 'No',
    help: 'A dónde se manda el reporte mensual en PDF.',
  },
  {
    column: 'planta',
    required: 'Sí',
    help: 'Nombre de la planta (por ejemplo "Casa" o "Techo bodega"). No se puede repetir para el mismo cliente.',
  },
  {
    column: 'capacidad_kwp',
    required: 'Sí',
    help: 'Paneles × watts de cada uno ÷ 1000. Ej.: 12 de 550 W = 6.6.',
  },
  {
    column: 'marca_inversor',
    required: 'Sí',
    help: 'GoodWe, Growatt, Victron, Huawei, Fronius, Enphase u Otra.',
  },
  {
    column: 'puesta_en_marcha',
    required: 'No',
    help: 'Fecha en que empezó a generar: 2025-03-10 o 10/03/2025.',
  },
  {
    column: 'modelo_inversor, serie_inversor, modelo_panel, numero_paneles',
    required: 'No',
    help: 'Datos técnicos de la etiqueta y la hoja técnica.',
  },
  {
    column: 'inclinacion, orientacion',
    required: 'No',
    help: 'Grados. Vacíos: los valores por omisión de la empresa (orientación 180 = sur).',
  },
  {
    column: 'latitud_planta, longitud_planta',
    required: 'No',
    help: 'Solo si la planta está en otro lugar que el domicilio del cliente.',
  },
  {
    column: 'con_bateria, limite_inyeccion',
    required: 'No',
    help: 'Sí o no (vacío es no). Si la planta tiene batería o límite de inyección a la red, no se generan alertas de suciedad ni de caída de rendimiento.',
  },
];

/**
 * Texto del archivo: UTF-8 (con o sin BOM), o Windows-1252 si Excel lo guardó como "CSV"
 * normal (así los acentos y la ñ no se dañan).
 */
export async function readCsvFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

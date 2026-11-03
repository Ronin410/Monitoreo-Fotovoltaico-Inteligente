import { randomUUID } from 'node:crypto';
import {
  companyExport,
  companyExportStats,
  type CompanyExportStats,
  type StorageProvider,
} from '@pv/adapters';
import { csvRow } from '@pv/core';
import { Prisma, withTenant, type PrismaClient, type TenantDb } from '@pv/db';
import { Zip, ZipDeflate } from 'fflate';

// Exportación de los datos de una empresa (docs/plan-lanzamiento.md 3.7): un ZIP con un CSV por
// tabla, para que la instaladora conserve su información al terminar el contrato o cuando la pida
// (derecho de acceso de sus clientes). Todo se lee con withTenant, en páginas y transacciones
// cortas. Nunca incluye contraseñas, credenciales de inversor ni tokens.

export const EXPORT_JOB_NAME = companyExport.name;
const PAGE = 5000;

export const exportKey = (companyId: string) => `exports/${companyId}/${randomUUID()}.zip`;

type Row = Record<string, unknown>;
type Pages = (db: PrismaClient, companyId: string) => AsyncGenerator<Row[]>;

/** Páginas por id, para tablas con llave uuid. */
function byId<T extends { id: string }>(
  fetch: (tx: TenantDb, args: { where: { id?: { gt: string } }; take: number }) => Promise<T[]>,
): Pages {
  return async function* (db, companyId) {
    let after: string | undefined;
    for (;;) {
      const rows = await withTenant(db, companyId, (tx) =>
        fetch(tx, { where: after ? { id: { gt: after } } : {}, take: PAGE }),
      );
      if (rows.length) yield rows;
      if (rows.length < PAGE) return;
      after = rows[rows.length - 1]?.id;
    }
  };
}

/** Series por planta (lecturas, clima, métricas), con las plantas eliminadas incluidas. */
function byPlant<T extends Row>(
  fetch: (tx: TenantDb, plantId: string, after: Date | undefined) => Promise<T[]>,
  cursor: (row: T) => Date,
): Pages {
  return async function* (db, companyId) {
    const plants = await withTenant(db, companyId, (tx) =>
      tx.solarPlant.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    for (const { id } of plants) {
      let after: Date | undefined;
      for (;;) {
        const rows = await withTenant(db, companyId, (tx) => fetch(tx, id, after));
        if (rows.length) yield rows;
        const last = rows[rows.length - 1];
        if (rows.length < PAGE || !last) break;
        after = cursor(last);
      }
    }
  };
}

const fields = (e: Record<string, string>, omit: string[] = []) =>
  Object.values(e).filter((f) => !omit.includes(f));

/** "companyId" → "company_id", como en la base. */
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

type Sheet = { file: string; description: string; fields: string[]; pages: Pages };

const asc = { id: 'asc' } as const;

const SHEETS: Sheet[] = [
  {
    file: 'usuarios.csv',
    description: 'Personas con acceso a la plataforma (sin contraseñas)',
    fields: fields(Prisma.UserScalarFieldEnum, ['passwordHash']),
    pages: byId((tx, a) => tx.user.findMany({ ...a, omit: { passwordHash: true }, orderBy: asc })),
  },
  {
    file: 'clientes.csv',
    description: 'Clientes finales, también los eliminados (deleted_at)',
    fields: fields(Prisma.ClientScalarFieldEnum),
    pages: byId((tx, a) => tx.client.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'plantas.csv',
    description: 'Plantas solares y sus datos técnicos (sin credenciales del inversor)',
    fields: fields(Prisma.SolarPlantScalarFieldEnum),
    pages: byId((tx, a) => tx.solarPlant.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'lecturas_15min.csv',
    description: 'Lecturas del inversor cada 15 minutos (se conservan 13 meses)',
    fields: fields(Prisma.TelemetryReadingScalarFieldEnum),
    pages: byPlant(
      (tx, plantId, after) =>
        tx.telemetryReading.findMany({
          where: { plantId, ...(after && { ts: { gt: after } }) },
          orderBy: { ts: 'asc' },
          take: PAGE,
        }),
      (r) => r.ts,
    ),
  },
  {
    file: 'clima_por_hora.csv',
    description: 'Clima por hora de cada planta',
    fields: fields(Prisma.PlantWeatherHourlyScalarFieldEnum),
    pages: byPlant(
      (tx, plantId, after) =>
        tx.plantWeatherHourly.findMany({
          where: { plantId, ...(after && { ts: { gt: after } }) },
          orderBy: { ts: 'asc' },
          take: PAGE,
        }),
      (r) => r.ts,
    ),
  },
  {
    file: 'metricas_diarias.csv',
    description: 'Energía, rendimiento (PR), suciedad y estado de cada planta por día',
    fields: fields(Prisma.PlantDailyMetricScalarFieldEnum),
    pages: byPlant(
      (tx, plantId, after) =>
        tx.plantDailyMetric.findMany({
          where: { plantId, ...(after && { date: { gt: after } }) },
          orderBy: { date: 'asc' },
          take: PAGE,
        }),
      (r) => r.date,
    ),
  },
  {
    file: 'eventos_planta.csv',
    description: 'Limpiezas, mantenimientos y otros eventos',
    fields: fields(Prisma.PlantEventScalarFieldEnum),
    pages: byId((tx, a) => tx.plantEvent.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'alertas.csv',
    description: 'Alertas con su evidencia y su explicación',
    fields: fields(Prisma.AlertScalarFieldEnum),
    pages: byId((tx, a) => tx.alert.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'tickets.csv',
    description: 'Tickets de mantenimiento',
    fields: fields(Prisma.MaintenanceTicketScalarFieldEnum),
    pages: byId((tx, a) => tx.maintenanceTicket.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'notificaciones.csv',
    description: 'Correos enviados o por enviar',
    fields: fields(Prisma.NotificationScalarFieldEnum),
    pages: byId((tx, a) => tx.notification.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'reportes_mensuales.csv',
    description: 'Reportes mensuales: cifras, texto y envío (los PDF no se incluyen)',
    fields: fields(Prisma.MonthlyReportScalarFieldEnum, ['storageKey']),
    pages: byId((tx, a) =>
      tx.monthlyReport.findMany({ ...a, omit: { storageKey: true }, orderBy: asc }),
    ),
  },
  {
    file: 'conversaciones_ia.csv',
    description: 'Conversaciones con el asistente',
    fields: fields(Prisma.AiConversationScalarFieldEnum),
    pages: byId((tx, a) => tx.aiConversation.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'mensajes_ia.csv',
    description: 'Mensajes de esas conversaciones',
    fields: fields(Prisma.AiMessageScalarFieldEnum),
    pages: byId((tx, a) => tx.aiMessage.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'uso_ia.csv',
    description: 'Tokens de IA consumidos por mes y función',
    fields: fields(Prisma.AiUsageMonthlyScalarFieldEnum),
    pages: byId((tx, a) => tx.aiUsageMonthly.findMany({ ...a, orderBy: asc })),
  },
  {
    file: 'auditoria.csv',
    description: 'Registro de acciones sensibles (inicios de sesión, cambios, envíos)',
    fields: fields(Prisma.AuditLogScalarFieldEnum),
    pages: byId((tx, a) => tx.auditLog.findMany({ ...a, orderBy: asc })),
  },
];

/** Campos que nunca salen en una exportación, aunque alguien los agregue a una tabla. */
const FORBIDDEN = /password|tokenHash|ciphertext|authTag|secret|storageKey/i;

const encoder = new TextEncoder();
const BOM = '﻿';

/** ZIP en memoria, comprimido archivo por archivo a medida que llegan los renglones. */
class ZipBuilder {
  private readonly chunks: Uint8Array[] = [];
  private error: Error | null = null;
  private readonly zip = new Zip((err, chunk) => {
    if (err) this.error = err;
    else this.chunks.push(chunk);
  });

  file(name: string) {
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    return {
      write: (text: string) => entry.push(encoder.encode(text)),
      end: () => entry.push(new Uint8Array(0), true),
    };
  }

  finish(): Buffer {
    this.zip.end();
    if (this.error) throw this.error;
    return Buffer.concat(this.chunks);
  }
}

function readme(companyName: string, at: Date, counts: Record<string, number>): string {
  const lines = [
    `Exportación de datos de ${companyName} en PV-IoT`,
    `Generada: ${at.toISOString()} (UTC)`,
    '',
    'Formato: archivos CSV en UTF-8, separados por comas; se abren en Excel. Las fechas y horas',
    'están en UTC (ISO 8601). Los campos JSON van como texto. Un texto que empieza con =, +, - o @',
    "lleva un apóstrofo (') al inicio para que Excel no lo ejecute como fórmula.",
    '',
    'Archivos:',
    ...[{ file: 'empresa.csv', description: 'Datos y configuración de la empresa' }, ...SHEETS].map(
      (s) => `- ${s.file}: ${s.description} (${counts[s.file] ?? 0} renglones)`,
    ),
    '',
    'No se incluyen: contraseñas, credenciales de los portales de inversores, invitaciones',
    'pendientes ni los PDF de los reportes mensuales (sus cifras y textos sí están).',
    '',
  ];
  return lines.join('\r\n');
}

/** Arma el ZIP de la empresa. Devuelve el archivo y los renglones por CSV. */
export async function buildCompanyExport(
  db: PrismaClient,
  companyId: string,
  now: Date,
): Promise<{ zip: Buffer; files: Record<string, number> }> {
  const zip = new ZipBuilder();
  const counts: Record<string, number> = {};
  const writeSheet = async (file: string, columns: string[], pages: AsyncIterable<Row[]>) => {
    const bad = columns.find((c) => FORBIDDEN.test(c));
    if (bad) throw new Error(`La exportación no puede incluir el campo ${bad}`);
    const out = zip.file(file);
    out.write(BOM + csvRow(columns.map(snake)));
    let n = 0;
    for await (const rows of pages) {
      out.write(rows.map((r) => csvRow(columns.map((c) => r[c]))).join(''));
      n += rows.length;
    }
    out.end();
    counts[file] = n;
  };

  const company = await withTenant(db, companyId, (tx) =>
    tx.company.findUniqueOrThrow({ where: { id: companyId } }),
  );
  await writeSheet(
    'empresa.csv',
    fields(Prisma.CompanyScalarFieldEnum),
    (async function* () {
      yield [company as Row];
    })(),
  );
  for (const sheet of SHEETS)
    await writeSheet(sheet.file, sheet.fields, sheet.pages(db, companyId));

  const info = zip.file('LEEME.txt');
  info.write(readme(company.name, now, counts));
  info.end();
  return { zip: zip.finish(), files: counts };
}

/**
 * Genera la exportación y la sube al almacenamiento. La API solo ofrece la última; los archivos
 * viejos se borran aquí, salvo el de la exportación anterior: mientras esta corre, la anterior
 * sigue en pantalla como descargable y su archivo debe existir.
 */
export async function runCompanyExport(
  deps: { db: PrismaClient; storage: StorageProvider; now: () => Date },
  companyId: string,
): Promise<CompanyExportStats> {
  const { zip, files } = await buildCompanyExport(deps.db, companyId, deps.now());
  const key = exportKey(companyId);
  await deps.storage.put(key, zip, 'application/zip');

  const previous = await withTenant(deps.db, companyId, (tx) =>
    tx.jobRun.findMany({
      where: { jobName: EXPORT_JOB_NAME, status: 'succeeded' },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    }),
  );
  for (const run of previous.slice(1)) {
    const stats = companyExportStats.safeParse(run.stats);
    if (stats.success && stats.data.storage_key.startsWith(`exports/${companyId}/`)) {
      await deps.storage.delete(stats.data.storage_key);
    }
  }
  return { storage_key: key, size_bytes: zip.length, files };
}

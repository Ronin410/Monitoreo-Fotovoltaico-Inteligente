import type { StorageProvider } from '@pv/adapters';
import type { ReportPdfInput } from './pdf.js';

// Archivos del reporte en storage: el logo que subió la empresa y el PDF generado.

/** Llave del PDF de un reporte; siempre bajo la carpeta de su empresa. */
export const reportPdfKey = (companyId: string, period: string, reportId: string) =>
  `reports/${companyId}/${period}/${reportId}.pdf`;

const LOGO_FORMATS: Record<string, 'png' | 'jpg'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/**
 * Logo de la empresa para el PDF. La llave sale del último segmento de `logo_url`
 * (`logos/{companyId}/{archivo}`, como lo guarda la API) y nunca de otra empresa.
 * Los SVG no se pueden incrustar en el PDF: se omiten.
 */
export async function loadReportLogo(
  storage: StorageProvider,
  company: { id: string; logoUrl: string | null },
): Promise<ReportPdfInput['logo']> {
  const file = company.logoUrl?.split('/').at(-1);
  if (!file || !/^[0-9a-f-]{36}\.(png|jpe?g)$/i.test(file)) return null;
  const obj = await storage.get(`logos/${company.id}/${file}`);
  const format = obj && LOGO_FORMATS[obj.contentType];
  return obj && format ? { data: obj.body, format } : null;
}

/** Genera la llave y guarda el PDF; regresa la llave para `monthly_reports.storage_key`. */
export async function storeReportPdf(
  storage: StorageProvider,
  report: { id: string; companyId: string; period: string },
  pdf: Buffer,
): Promise<string> {
  const key = reportPdfKey(report.companyId, report.period, report.id);
  await storage.put(key, pdf, 'application/pdf');
  return key;
}

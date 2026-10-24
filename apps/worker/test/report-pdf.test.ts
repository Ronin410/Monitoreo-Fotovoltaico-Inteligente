import { buildReportFacts, type ReportPlantInput } from '@pv/core';
import { MemoryStorageProvider } from '@pv/adapters';
import { describe, expect, it } from 'vitest';
import { renderReportPdf } from '../src/reports/pdf.js';
import { loadReportLogo, reportPdfKey, storeReportPdf } from '../src/reports/storage.js';

// specs/08 §5: PDF sin errores para una planta, varias, alta a mitad de mes y mes sin datos.

const plant = (name: string, first = '2026-09-01', energy = 35): ReportPlantInput => ({
  name,
  capacityKwp: 8.2,
  firstDay: first,
  daysInPeriod: 31 - Number(first.slice(8)),
  days: Array.from({ length: 31 - Number(first.slice(8)) }, (_, i) => {
    const date = `2026-09-${String(Number(first.slice(8)) + i).padStart(2, '0')}`;
    return {
      date,
      energyKwh: energy + (i % 5),
      expectedTempKwh: 42,
      isValidDay: true,
      rainMm: 0,
      cloudCoverAvgPct: 20,
    };
  }),
  sunHours: 360,
  sunHoursWithData: 355,
});

const factsFor = (plants: ReportPlantInput[]) =>
  buildReportFacts({
    period: '2026-09',
    clientName: 'Abarrotes El Sol, S.A. de C.V.',
    plants,
    energyPrevMonthKwh: 1100,
    energySameMonthLastYearKwh: null,
    tariffMxnPerKwh: 3.5,
    co2KgPerKwh: 0.438,
    avgMonthlyKwh: null,
    alertsOpened: 0,
    alertsResolved: 0,
    cleanings: 0,
    openIssues: [],
  });

const NARRATIVE =
  'En septiembre, su sistema generó energía limpia día con día. ¿Sabía que evitó emisiones de CO₂? Año con año, señal de ahorro: niño, acción, búsqueda.';

async function render(
  plants: ReportPlantInput[],
  logo: Parameters<typeof renderReportPdf>[0]['logo'] = null,
) {
  const pdf = await renderReportPdf({
    facts: factsFor(plants),
    narrative: NARRATIVE,
    company: { name: 'Solar Demo Culiacán', brandColor: '#F59E0B' },
    logo,
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  // Menos de 1 MB y con la fuente embebida.
  expect(pdf.length).toBeLessThan(1024 * 1024);
  expect(pdf.toString('latin1')).toMatch(/FontFile|Inter/);
  return pdf;
}

describe('PDF del reporte mensual', () => {
  it('cliente con una planta', async () => {
    await render([plant('Casa')]);
  }, 30_000);
  it('cliente con varias plantas (incluye la tabla) y una instalada a mitad de mes', async () => {
    await render([plant('Casa'), plant('Bodega', '2026-09-16', 60)]);
  }, 30_000);
  it('mes sin datos', async () => {
    await render([{ ...plant('Nueva'), days: [], sunHours: 0, sunHoursWithData: 0 }]);
  }, 30_000);
});

// PNG de 1×1 px.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222.png';

describe('archivos del reporte en storage', () => {
  it('carga el logo PNG de la empresa y lo incrusta', async () => {
    const storage = new MemoryStorageProvider();
    await storage.put(`logos/${COMPANY}/${FILE}`, PNG, 'image/png');
    const logo = await loadReportLogo(storage, {
      id: COMPANY,
      logoUrl: `http://localhost:4000/api/public/logos/${COMPANY}/${FILE}`,
    });
    expect(logo?.format).toBe('png');
    await render([plant('Casa')], logo);
  }, 30_000);

  it('omite logos SVG, ausentes o de otra empresa', async () => {
    const storage = new MemoryStorageProvider();
    const other = '33333333-3333-4333-8333-333333333333';
    await storage.put(`logos/${other}/${FILE}`, PNG, 'image/png');
    const svg = FILE.replace('.png', '.svg');
    await storage.put(`logos/${COMPANY}/${svg}`, Buffer.from('<svg/>'), 'image/svg+xml');
    const load = (logoUrl: string | null) => loadReportLogo(storage, { id: COMPANY, logoUrl });
    expect(await load(null)).toBeNull();
    expect(await load(`http://x/api/public/logos/${COMPANY}/${svg}`)).toBeNull();
    // La URL apunta a otra empresa, pero la llave siempre usa la empresa del reporte.
    expect(await load(`http://x/api/public/logos/${other}/${FILE}`)).toBeNull();
    expect(await load(`http://x/api/public/logos/${COMPANY}/..%2F..%2Fsecreto`)).toBeNull();
  });

  it('guarda el PDF bajo la carpeta de la empresa', async () => {
    const storage = new MemoryStorageProvider();
    const report = {
      id: '44444444-4444-4444-8444-444444444444',
      companyId: COMPANY,
      period: '2026-09',
    };
    const key = await storeReportPdf(storage, report, Buffer.from('%PDF-1.3'));
    expect(key).toBe(reportPdfKey(COMPANY, '2026-09', report.id));
    expect(key.startsWith(`reports/${COMPANY}/`)).toBe(true);
    expect(await storage.get(key)).toEqual({
      body: Buffer.from('%PDF-1.3'),
      contentType: 'application/pdf',
    });
  });
});

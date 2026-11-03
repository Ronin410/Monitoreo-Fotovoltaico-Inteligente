// Lectura de CSV para la importación masiva (docs/plan-lanzamiento.md 6.4). Función pura: acepta
// comillas dobles (RFC 4180), saltos de línea dentro de comillas y archivos de Excel en español,
// que separan con ";" y usan coma decimal.

export type CsvTable = { delimiter: ',' | ';'; headers: string[]; rows: string[][] };

/** Encabezado comparable: minúsculas, sin acentos, espacios y guiones como "_". */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function detectDelimiter(firstLine: string): ',' | ';' {
  const count = (c: string) => firstLine.split(c).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^\uFEFF/, ''); // BOM de Excel
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  const [header = [], ...rows] = nonEmpty;
  return { delimiter, headers: header.map(normalizeHeader), rows };
}

/** Número escrito por una persona: "6.6", "6,6" (coma decimal) o "1,234.5"; null si está vacío. */
// NaN si no es un número.
export function parseLooseNumber(raw: string | undefined): number | null {
  const v = (raw ?? '').trim().replace(/\s/g, '');
  if (v === '') return null;
  const normalized = v.includes('.') ? v.replace(/,/g, '') : v.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Valor de una celda al exportar: fechas en ISO 8601 (UTC), JSON como texto, nulos vacíos. */
export function csvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  // Decimal de Prisma y similares: su texto exacto, sin pasar por número.
  if (typeof value === 'object' && 'toFixed' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return JSON.stringify(value);
}

/**
 * Un renglón CSV (separado por comas, fin de línea CRLF). Entrecomilla lo que lleva comas,
 * comillas o saltos de línea. Un texto que Excel tomaría como fórmula (empieza con =, +, -, @,
 * tabulador o retorno) se antepone con un apóstrofo, salvo que sea un número.
 */
export function csvRow(values: unknown[]): string {
  return (
    values
      .map((v) => {
        let s = csvValue(v);
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) {
          s = `'${s}`;
        }
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',') + '\r\n'
  );
}

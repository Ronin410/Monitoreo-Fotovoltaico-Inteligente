import { createRequire } from 'node:module';
import {
  Document,
  Font,
  Image,
  Page,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { ReportFacts } from '@pv/core';

// PDF del reporte mensual (specs/08 §4): carta, 1–2 páginas, marca de la empresa, tarjetas,
// barras de energía diaria, narrativa, tabla por planta y pie con la tarifa usada.

const require = createRequire(import.meta.url);
let fontsReady = false;
/** Inter embebida (subconjunto latino: acentos, ñ, ¿ y ¡). */
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: 'Inter',
    fonts: [
      { src: require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff') },
      {
        src: require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff'),
        fontWeight: 700,
      },
    ],
  });
  // Sin cortes de palabra con guiones.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const monthTitle = (period: string) => {
  const m = MONTHS[Number(period.slice(5, 7)) - 1] ?? '';
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${period.slice(0, 4)}`;
};
const nf = (digits: number) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kwh = (v: number) => `${nf(v >= 100 ? 0 : 1).format(v)} kWh`;
const mxn = (v: number) => `$${nf(2).format(v)} MXN`;
/** El subíndice de CO₂ no está en la fuente embebida. */
const plain = (s: string) => s.replace(/₂/g, '2');

const CHART_BLUE = '#2a78d6';
const INK = '#14181F';
const MUTED = '#5B6472';

function readableOn(hex: string): string {
  const c = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#0E7490';
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0596 ? '#FFFFFF' : INK;
}

const s = StyleSheet.create({
  page: { fontFamily: 'Inter', fontSize: 10, color: INK, padding: 36, paddingBottom: 64 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 6 },
  logo: {
    width: 40,
    height: 40,
    objectFit: 'contain',
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
  },
  title: { fontSize: 16, fontWeight: 700, marginTop: 18 },
  subtitle: { fontSize: 11, color: MUTED, marginTop: 2 },
  cards: { flexDirection: 'row', gap: 8, marginTop: 16 },
  card: { flex: 1, border: '1pt solid #E2E5EA', borderRadius: 6, padding: 10 },
  cardLabel: { fontSize: 8, color: MUTED },
  cardValue: { fontSize: 13, fontWeight: 700, marginTop: 4 },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  narrative: { fontSize: 10.5, lineHeight: 1.5 },
  row: { flexDirection: 'row', borderBottom: '1pt solid #EEF0F3', paddingVertical: 4 },
  th: { fontWeight: 700, fontSize: 9, color: MUTED },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.4,
  },
});

function DailyChart({ facts }: { facts: ReportFacts }) {
  const days = facts.daily_energy;
  if (days.length === 0)
    return <Text style={{ color: MUTED }}>Sin datos de generación en el mes.</Text>;
  const width = 540;
  const height = 120;
  const max = Math.max(...days.map((d) => d.energy_kwh), 1);
  const slot = width / days.length;
  const bar = Math.max(2, slot - 2);
  return (
    <View>
      <Svg width={width} height={height}>
        <Rect x={0} y={height - 0.5} width={width} height={0.5} fill="#C9CED6" />
        {days.map((d, i) => {
          const h = Math.max(1, (d.energy_kwh / max) * (height - 4));
          return (
            <Rect
              key={d.date}
              x={i * slot + 1}
              y={height - h}
              width={bar}
              height={h}
              fill={CHART_BLUE}
              rx={1.5}
            />
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
        <Text style={{ fontSize: 8, color: MUTED }}>{Number(days[0]?.date.slice(8))}</Text>
        <Text style={{ fontSize: 8, color: MUTED }}>Máximo: {kwh(max)} en un día</Text>
        <Text style={{ fontSize: 8, color: MUTED }}>{Number(days.at(-1)?.date.slice(8))}</Text>
      </View>
    </View>
  );
}

export type ReportPdfInput = {
  facts: ReportFacts;
  narrative: string;
  company: { name: string; brandColor: string };
  /** Logo PNG o JPG (los SVG no se pueden incrustar y se omiten). */
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
};

export function ReportDocument({ facts, narrative, company, logo }: ReportPdfInput) {
  const brand = /^#[0-9a-fA-F]{6}$/.test(company.brandColor) ? company.brandColor : '#0E7490';
  const onBrand = readableOn(brand);
  const change = facts.energy_change_pct;
  return (
    <Document
      title={`Reporte ${facts.period} — ${facts.client_name}`}
      author={company.name}
      language="es-MX"
    >
      <Page size="LETTER" style={s.page}>
        <View style={[s.header, { backgroundColor: brand }]}>
          {logo && <Image style={s.logo} src={logo} />}
          <Text style={{ color: onBrand, fontSize: 14, fontWeight: 700 }}>{company.name}</Text>
        </View>
        <Text style={s.title}>Reporte de generación solar — {monthTitle(facts.period)}</Text>
        <Text style={s.subtitle}>{facts.client_name}</Text>

        <View style={s.cards}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Energía generada</Text>
            <Text style={s.cardValue}>{kwh(facts.energy_kwh)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Ahorro estimado</Text>
            <Text style={s.cardValue}>{mxn(facts.savings_mxn)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>CO2 evitado</Text>
            <Text style={s.cardValue}>{nf(1).format(facts.co2_avoided_kg)} kg</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Contra el mes anterior</Text>
            <Text style={s.cardValue}>
              {change === null ? '—' : `${change > 0 ? '+' : ''}${nf(1).format(change)} %`}
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Energía de cada día</Text>
          <DailyChart facts={facts} />
        </View>

        <View style={s.section}>
          <Text style={s.narrative}>{plain(narrative)}</Text>
        </View>

        {facts.plants.length > 1 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Sus sistemas</Text>
            <View style={s.row}>
              <Text style={[s.th, { flex: 3 }]}>Sistema</Text>
              <Text style={[s.th, { flex: 2, textAlign: 'right' }]}>Energía</Text>
              <Text style={[s.th, { flex: 2, textAlign: 'right' }]}>Por cada kW instalado</Text>
              <Text style={[s.th, { flex: 2, textAlign: 'right' }]}>Disponibilidad</Text>
            </View>
            {facts.plants.map((p) => (
              <View key={p.name} style={s.row}>
                <Text style={{ flex: 3 }}>
                  {p.name}
                  {p.days_counted ? ` (${p.days_counted} días)` : ''}
                </Text>
                <Text style={{ flex: 2, textAlign: 'right' }}>{kwh(p.energy_kwh)}</Text>
                <Text style={{ flex: 2, textAlign: 'right' }}>
                  {p.specific_yield === null ? '—' : `${nf(1).format(p.specific_yield)} kWh`}
                </Text>
                <Text style={{ flex: 2, textAlign: 'right' }}>
                  {p.availability_pct === null ? '—' : `${nf(1).format(p.availability_pct)} %`}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          <Text>
            {company.name} · Monitoreo con PV-IoT. Cifras de ahorro estimadas con base en la tarifa
            de ${nf(2).format(facts.tariff_mxn_per_kwh)} MXN/kWh.
          </Text>
          <Text>
            Este reporte contiene información de su sistema solar para su uso personal;{' '}
            {company.name} trata sus datos conforme a su aviso de privacidad.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** PDF del reporte como Buffer. */
export async function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportDocument {...input} />);
}

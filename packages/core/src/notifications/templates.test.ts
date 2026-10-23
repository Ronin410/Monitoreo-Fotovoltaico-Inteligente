import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail, type EmailBrand } from './templates.js';

const BRAND: EmailBrand = {
  companyName: 'Solar Demo Culiacán',
  brandColor: '#0E7490',
  logoUrl: null,
  timezone: 'America/Mazatlan',
};
const APP = 'https://app.pv-iot.example/';
const ALERT_ID = '0b9f6f2e-7a43-4c39-9b8e-0f6a1c2d3e4f';

const alertPayload = {
  alert_id: ALERT_ID,
  type: 'sudden_drop',
  severity: 'critical',
  plant_name: 'Comercial Centro',
  client_name: 'Abarrotes El Sol',
  colonia: 'Centro',
  detected_at: '2026-10-22T05:00:00.000Z',
  deviation_pct: 45.04,
};

describe('correo de alerta nueva', () => {
  it('asunto con severidad y tipo, datos de la planta y enlace a la alerta', () => {
    const email = renderEmail('alert_opened', alertPayload, BRAND, APP);
    expect(email.subject).toBe('[Crítica] Caída brusca de producción — Comercial Centro');
    expect(email.text).toContain('Cliente: Abarrotes El Sol');
    expect(email.text).toContain('Por debajo de lo normal: 45.0 %');
    // 05:00 UTC = 22:00 del día anterior en Culiacán.
    expect(email.text).toMatch(/Detectada: 21 oct/);
    expect(email.text).toContain(`Ver la alerta: https://app.pv-iot.example/alerts/${ALERT_ID}`);
    expect(email.html).toContain('background:#0E7490');
    expect(email.html).toContain('Solar Demo Culiacán');
  });

  it('escapa el texto de la empresa y la planta, y no acepta colores ni logos raros', () => {
    const email = renderEmail(
      'alert_opened',
      { ...alertPayload, plant_name: '<script>alert(1)</script>' },
      {
        ...BRAND,
        companyName: 'A & B "Solar"',
        brandColor: 'red;x:expression(1)',
        logoUrl: 'javascript:alert(1)',
      },
      APP,
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B &quot;Solar&quot;');
    expect(email.html).not.toContain('expression');
    expect(email.html).not.toContain('javascript:');
    expect(email.html).toContain('background:#0E7490');
  });

  it('con logo https lo usa en el encabezado', () => {
    const email = renderEmail(
      'alert_opened',
      alertPayload,
      { ...BRAND, logoUrl: 'https://api.example/logo.png' },
      APP,
    );
    expect(email.html).toContain('<img src="https://api.example/logo.png"');
  });

  it('con el resumen de la explicación, lo usa como texto principal (escapado)', () => {
    const email = renderEmail(
      'alert_opened',
      { ...alertPayload, summary: 'Cayó 45 % <b>por</b> una falla.' },
      BRAND,
      APP,
    );
    expect(email.text).toContain('Cayó 45 % <b>por</b> una falla.');
    expect(email.html).toContain('Cayó 45 % &lt;b&gt;por&lt;/b&gt; una falla.');
    expect(email.text).not.toContain('La producción cayó de golpe');
  });

  it('rechaza un payload inválido', () => {
    expect(() =>
      renderEmail('alert_opened', { ...alertPayload, severity: 'x' }, BRAND, APP),
    ).toThrow();
  });
});

describe('ticket asignado y resumen diario', () => {
  it('ticket con dirección, teléfono, fecha y enlace al mapa', () => {
    const email = renderEmail(
      'ticket_assigned',
      {
        ticket_id: ALERT_ID,
        title: 'Lavado de paneles — Comercial Centro',
        priority: 'high',
        description: 'Posible suciedad.',
        scheduled_for: '2026-10-24',
        plant_name: 'Comercial Centro',
        client_name: 'Abarrotes El Sol',
        client_phone: '667 123 4567',
        address: 'Av. Obregón 100',
        colonia: 'Centro',
        lat: 24.8069,
        lon: -107.3938,
      },
      BRAND,
      APP,
    );
    expect(email.subject).toBe('Nuevo ticket asignado: Lavado de paneles — Comercial Centro');
    expect(email.text).toContain('Dirección: Av. Obregón 100, Centro');
    expect(email.text).toContain('Prioridad: alta');
    expect(email.text).toContain('Teléfono: 667 123 4567');
    expect(email.text).toMatch(/Programado: sábado, 24 de octubre/);
    expect(email.text).toContain(
      'https://www.google.com/maps/search/?api=1&query=24.8069,-107.3938',
    );
    expect(email.text).toContain(`/tickets/${ALERT_ID}`);
  });

  it('resumen con conteos, atención, lavados y plantas sin datos', () => {
    const email = renderEmail(
      'daily_summary',
      {
        date: '2026-10-23',
        open_alerts: { critical: 1, warning: 2, info: 1 },
        attention: [
          {
            alert_id: ALERT_ID,
            plant_name: 'Residencial Centro 22',
            type: 'offline',
            severity: 'critical',
          },
        ],
        upcoming_cleanings: [
          { plant_name: 'Comercial Infonavit 18', days_to_cleaning: 1 },
          { plant_name: 'Residencial Tres Ríos 16', days_to_cleaning: 5 },
        ],
        offline_plants: [{ plant_name: 'Residencial Centro 22' }],
      },
      BRAND,
      APP,
    );
    expect(email.subject).toBe('Resumen diario de Solar Demo Culiacán — viernes, 23 de octubre');
    expect(email.text).toContain('Alertas abiertas: 1 críticas, 2 de advertencia y 1 avisos.');
    expect(email.text).toContain('- Residencial Centro 22: Planta sin datos (Crítica)');
    expect(email.text).toContain('- Comercial Infonavit 18: en 1 día');
    expect(email.text).toContain('- Residencial Tres Ríos 16: en 5 días');
    expect(email.html).toContain('<li>Residencial Centro 22</li>');
  });

  it('aviso de presupuesto de IA al 80 %', () => {
    const email = renderEmail(
      'ai_budget_warning',
      { period: '2026-10', used_tokens: 1_650_000, budget_tokens: 2_000_000 },
      BRAND,
      APP,
    );
    expect(email.subject).toBe('Uso de IA al 83 % del presupuesto del mes');
    expect(email.text).toContain('Tokens usados: 1,650,000');
    expect(email.text).toContain('https://app.pv-iot.example/settings');
    expect(
      renderEmail(
        'ai_budget_warning',
        { period: '2026-10', used_tokens: 5, budget_tokens: 0 },
        BRAND,
        APP,
      ).subject,
    ).toBe('Uso de IA al 100 % del presupuesto del mes');
  });

  it('escapeHtml cubre los cinco caracteres', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

import { z } from 'zod';

// Plantillas de correo de specs/06 §6, en español y con la marca de la empresa. Funciones puras:
// el payload se guarda en `notifications.payload` y el correo se arma al enviarlo.

const ALERT_TYPES = ['offline', 'sudden_drop', 'soiling', 'cleaning_due_soon'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;

export const alertOpenedPayload = z.object({
  alert_id: z.uuid(),
  type: z.enum(ALERT_TYPES),
  severity: z.enum(SEVERITIES),
  plant_name: z.string(),
  client_name: z.string(),
  colonia: z.string(),
  detected_at: z.iso.datetime({ offset: true }),
  /** Última desviación del disparo, si aplica. */
  deviation_pct: z.number().nullable(),
});

export const ticketAssignedPayload = z.object({
  ticket_id: z.uuid(),
  title: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
  description: z.string().nullable(),
  scheduled_for: z.iso.date().nullable(),
  plant_name: z.string(),
  client_name: z.string(),
  client_phone: z.string().nullable(),
  address: z.string(),
  colonia: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});

export const dailySummaryPayload = z.object({
  date: z.iso.date(),
  open_alerts: z.object({ critical: z.number(), warning: z.number(), info: z.number() }),
  attention: z.array(
    z.object({
      alert_id: z.uuid(),
      plant_name: z.string(),
      type: z.enum(ALERT_TYPES),
      severity: z.enum(SEVERITIES),
    }),
  ),
  upcoming_cleanings: z.array(z.object({ plant_name: z.string(), days_to_cleaning: z.number() })),
  offline_plants: z.array(z.object({ plant_name: z.string() })),
});

export const NOTIFICATION_TEMPLATES = {
  alert_opened: alertOpenedPayload,
  ticket_assigned: ticketAssignedPayload,
  daily_summary: dailySummaryPayload,
} as const;
export type NotificationTemplate = keyof typeof NOTIFICATION_TEMPLATES;
export type NotificationPayload<T extends NotificationTemplate> = z.infer<
  (typeof NOTIFICATION_TEMPLATES)[T]
>;

export type EmailBrand = {
  companyName: string;
  /** #RRGGBB; otro valor se ignora. */
  brandColor: string;
  logoUrl: string | null;
  timezone: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export const ALERT_TYPE_LABELS: Record<(typeof ALERT_TYPES)[number], string> = {
  offline: 'Planta sin datos',
  sudden_drop: 'Caída brusca de producción',
  soiling: 'Posible suciedad',
  cleaning_due_soon: 'Lavado próximo',
};
const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], string> = {
  critical: 'Crítica',
  warning: 'Advertencia',
  info: 'Aviso',
};
const PRIORITY_LABELS = { high: 'alta', normal: 'normal', low: 'baja' } as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#0E7490');
const safeUrl = (u: string | null) => (u && /^https?:\/\//.test(u) ? u : null);
const base = (appUrl: string) => appUrl.replace(/\/$/, '');

function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatDate(day: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));
}

/** Un párrafo: texto plano, o filas etiqueta–valor. */
type Block = { p: string } | { rows: [string, string][] } | { list: string[]; title: string };

function layout(
  brand: EmailBrand,
  heading: string,
  blocks: Block[],
  action: { label: string; url: string } | null,
): { text: string; html: string } {
  const color = safeColor(brand.brandColor);
  const logo = safeUrl(brand.logoUrl);
  const text: string[] = [heading, ''];
  const html: string[] = [];
  for (const b of blocks) {
    if ('p' in b) {
      text.push(b.p, '');
      html.push(`<p style="margin:0 0 16px">${escapeHtml(b.p)}</p>`);
    } else if ('rows' in b) {
      for (const [k, v] of b.rows) text.push(`${k}: ${v}`);
      text.push('');
      html.push(
        `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px">${b.rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:2px 16px 2px 0;color:#5B6472">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`,
          )
          .join('')}</table>`,
      );
    } else {
      text.push(`${b.title}:`, ...b.list.map((l) => `- ${l}`), '');
      html.push(
        `<p style="margin:0 0 6px;font-weight:600">${escapeHtml(b.title)}</p><ul style="margin:0 0 16px;padding-left:20px">${b.list
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join('')}</ul>`,
      );
    }
  }
  if (action) {
    text.push(`${action.label}: ${action.url}`, '');
    html.push(
      `<p style="margin:8px 0 16px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${color};color:#FFFFFF;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(action.label)}</a></p>`,
    );
  }
  text.push(`— ${brand.companyName} · Monitoreo con PV-IoT`);
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.companyName)}" height="32" style="display:block;height:32px">`
    : `<span style="font-size:16px;font-weight:700;color:#FFFFFF">${escapeHtml(brand.companyName)}</span>`;
  return {
    text: text.join('\n'),
    html: [
      '<!doctype html><html lang="es"><body style="margin:0;background:#F4F6F8;font-family:Arial,Helvetica,sans-serif;color:#14181F">',
      '<div style="max-width:560px;margin:0 auto;padding:24px 16px">',
      `<div style="background:${color};border-radius:10px 10px 0 0;padding:14px 20px">${header}</div>`,
      '<div style="background:#FFFFFF;border-radius:0 0 10px 10px;padding:20px;font-size:14px;line-height:1.5">',
      `<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(heading)}</h1>`,
      ...html,
      `<p style="margin:16px 0 0;font-size:12px;color:#5B6472">${escapeHtml(brand.companyName)} · Monitoreo con PV-IoT</p>`,
      '</div></div></body></html>',
    ].join(''),
  };
}

function alertOpened(p: NotificationPayload<'alert_opened'>, brand: EmailBrand, appUrl: string) {
  const label = ALERT_TYPE_LABELS[p.type];
  const subject = `[${SEVERITY_LABELS[p.severity]}] ${label} — ${p.plant_name}`;
  const what: Record<typeof p.type, string> = {
    offline: 'El inversor dejó de reportar durante horas con sol.',
    sudden_drop: 'La producción cayó de golpe frente a lo que permitía el clima.',
    soiling: 'La planta rinde por debajo de lo normal de forma sostenida y sin lluvia.',
    cleaning_due_soon: 'La tendencia indica que conviene lavar los paneles pronto.',
  };
  const rows: [string, string][] = [
    ['Planta', p.plant_name],
    ['Cliente', p.client_name],
    ['Colonia', p.colonia],
    ['Detectada', formatDateTime(p.detected_at, brand.timezone)],
  ];
  if (p.deviation_pct !== null) {
    rows.push(['Por debajo de lo normal', `${p.deviation_pct.toFixed(1)} %`]);
  }
  return {
    subject,
    ...layout(brand, `${label}: ${p.plant_name}`, [{ p: what[p.type] }, { rows }], {
      label: 'Ver la alerta',
      url: `${base(appUrl)}/alerts/${p.alert_id}`,
    }),
  };
}

function ticketAssigned(
  p: NotificationPayload<'ticket_assigned'>,
  brand: EmailBrand,
  appUrl: string,
) {
  const rows: [string, string][] = [
    ['Planta', p.plant_name],
    ['Cliente', p.client_name],
    ['Dirección', `${p.address}, ${p.colonia}`],
    ['Prioridad', PRIORITY_LABELS[p.priority]],
  ];
  if (p.client_phone) rows.push(['Teléfono', p.client_phone]);
  if (p.scheduled_for) rows.push(['Programado', formatDate(p.scheduled_for)]);
  if (p.lat !== null && p.lon !== null) {
    rows.push(['Mapa', `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`]);
  }
  const blocks: Block[] = [{ rows }];
  if (p.description) blocks.unshift({ p: p.description });
  return {
    subject: `Nuevo ticket asignado: ${p.title}`,
    ...layout(brand, p.title, blocks, {
      label: 'Abrir el ticket',
      url: `${base(appUrl)}/tickets/${p.ticket_id}`,
    }),
  };
}

function dailySummary(p: NotificationPayload<'daily_summary'>, brand: EmailBrand, appUrl: string) {
  const { critical, warning, info } = p.open_alerts;
  const blocks: Block[] = [
    {
      p: `Alertas abiertas: ${critical} críticas, ${warning} de advertencia y ${info} avisos.`,
    },
  ];
  if (p.attention.length) {
    blocks.push({
      title: 'Requieren atención',
      list: p.attention.map(
        (a) => `${a.plant_name}: ${ALERT_TYPE_LABELS[a.type]} (${SEVERITY_LABELS[a.severity]})`,
      ),
    });
  }
  if (p.upcoming_cleanings.length) {
    blocks.push({
      title: 'Próximos lavados',
      list: p.upcoming_cleanings.map(
        (c) =>
          `${c.plant_name}: ${c.days_to_cleaning <= 0 ? 'ya' : `en ${c.days_to_cleaning} ${c.days_to_cleaning === 1 ? 'día' : 'días'}`}`,
      ),
    });
  }
  if (p.offline_plants.length) {
    blocks.push({ title: 'Plantas sin datos', list: p.offline_plants.map((o) => o.plant_name) });
  }
  return {
    subject: `Resumen diario de ${brand.companyName} — ${formatDate(p.date)}`,
    ...layout(brand, `Resumen del ${formatDate(p.date)}`, blocks, {
      label: 'Abrir el tablero',
      url: `${base(appUrl)}/`,
    }),
  };
}

/** Arma el correo; valida el payload (viene de la base). */
export function renderEmail(
  template: NotificationTemplate,
  payload: unknown,
  brand: EmailBrand,
  appUrl: string,
): RenderedEmail {
  switch (template) {
    case 'alert_opened':
      return alertOpened(alertOpenedPayload.parse(payload), brand, appUrl);
    case 'ticket_assigned':
      return ticketAssigned(ticketAssignedPayload.parse(payload), brand, appUrl);
    case 'daily_summary':
      return dailySummary(dailySummaryPayload.parse(payload), brand, appUrl);
  }
}

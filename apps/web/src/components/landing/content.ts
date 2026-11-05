// Textos del sitio público (/inicio y sus secciones; docs/plan-lanzamiento.md 6.7). Reglas:
// - Solo funciones que existen hoy en la plataforma; lo que viene se dice como "próximamente".
// - Sin precios, testimonios, cifras inventadas ni certificaciones que no se tengan.
// Al cambiar el estado de una marca, actualizar BRANDS.

export const SITE_NAV = [
  { href: '/inicio', label: 'Inicio' },
  { href: '/inicio/funciones', label: 'Funciones' },
  { href: '/inicio/como-funciona', label: 'Cómo funciona' },
  { href: '/inicio/seguridad', label: 'Seguridad' },
  { href: '/inicio/contacto', label: 'Contacto' },
] as const;

/** Qué significa el nombre (para quien no conoce las siglas). */
export const NAME_MEANING =
  'PV de fotovoltaico (photovoltaic) e IoT de Internet de las cosas: paneles solares conectados que reportan solos cómo están.';

export const HIGHLIGHTS = [
  {
    title: 'Sabe si cada planta rinde lo que debe',
    text: 'Comparamos su producción con la esperada según el sol y la temperatura de ese día.',
  },
  {
    title: 'Lava en el momento justo',
    text: 'Le decimos cuántos días faltan para que convenga lavar cada planta.',
  },
  {
    title: 'Atiende fallas antes de la llamada',
    text: 'Alertas con evidencia y una explicación clara, listas para volverse ticket.',
  },
] as const;

export const PILLARS = [
  {
    id: 'rendimiento',
    eyebrow: 'Rendimiento real',
    title: 'No solo cuánto produjo: si eso es lo que debía producir',
    text: 'Cada noche calculamos la energía esperada de cada planta con el clima real de su ubicación, su inclinación y su orientación, y la comparamos con lo que entregó el inversor. Así una planta nublada no parece descompuesta.',
    points: [
      'Rendimiento corregido por temperatura',
      'Comparación con plantas vecinas',
      'Si toda una zona baja a la vez, no se culpa a ninguna planta',
    ],
    art: 'performance',
  },
  {
    id: 'lavado',
    eyebrow: 'Predicción de lavado',
    title: 'Lave cuando conviene, no por calendario',
    text: 'La suciedad hace que el rendimiento baje poco a poco. Medimos esa tendencia día con día y le decimos cuántos días faltan para que el lavado valga la pena. Si llueve lo suficiente, lo tomamos en cuenta.',
    points: [
      'Fecha estimada de lavado por planta',
      'Aviso preventivo una semana antes',
      'Comprueba con datos si el lavado funcionó',
    ],
    art: 'soiling',
  },
  {
    id: 'alertas',
    eyebrow: 'Alertas inteligentes',
    title: 'Fallas detectadas, explicadas y asignadas',
    text: 'Una caída brusca de producción, una planta sin datos o suciedad acumulada generan una alerta con la evidencia de los últimos días y una explicación en palabras simples. Con un clic se vuelve ticket para su técnico.',
    points: [
      'Caída brusca, suciedad y planta sin datos',
      'Explicación clara de cada alerta',
      'Tickets que el técnico atiende desde el celular',
    ],
    art: 'alerts',
  },
  {
    id: 'reportes',
    eyebrow: 'Reportes mensuales',
    title: 'Reportes que sus clientes entienden, con su marca',
    text: 'Cada mes, un PDF por cliente con la energía generada, el ahorro estimado y el estado de sus paneles, con el logo y el color de su empresa. Se pueden enviar solos por correo.',
    points: [
      'Energía y ahorro del mes',
      'Con el logo y el color de su empresa',
      'Envío automático opcional',
    ],
    art: 'report',
  },
] as const;

export type PillarArt = (typeof PILLARS)[number]['art'];

export const TOOLS = [
  { title: 'Tablero y mapa', text: 'Todas sus plantas con su estado del día.' },
  { title: 'Asistente con IA', text: 'Pregunte en español y responde con sus datos.' },
  { title: 'Alta desde Excel', text: 'Cientos de plantas con una plantilla.' },
  { title: 'Tiempos de atención', text: 'Cuánto tardan sus técnicos en resolver.' },
  { title: 'Plantas con batería', text: 'Sin falsas alarmas por producción limitada.' },
  { title: 'Casas y negocios', text: 'Filtre por tipo; las fallas de negocios salen primero.' },
  { title: 'Exportación de datos', text: 'Toda su información en archivos de Excel.' },
] as const;

export const STEPS = [
  {
    title: 'Dé de alta clientes y plantas',
    text: 'Uno por uno o todos a la vez desde Excel: capacidad, ubicación y marca del inversor.',
  },
  {
    title: 'Conecte los inversores',
    text: 'Con las llaves de acceso del portal de cada fabricante. Se guardan cifradas y no se vuelven a mostrar.',
  },
  {
    title: 'La plataforma trabaja sola',
    text: 'Lee la producción cada 15 minutos, descarga el clima, calcula el rendimiento cada noche y le avisa cuando algo requiere atención.',
  },
] as const;

export const BRANDS = [
  { name: 'Victron Energy', status: 'ready' },
  { name: 'GoodWe', status: 'integrating' },
  { name: 'Growatt', status: 'soon' },
  { name: 'Huawei', status: 'soon' },
  { name: 'Fronius', status: 'soon' },
  { name: 'Enphase', status: 'integrating' },
] as const;

export const BRAND_STATUS = {
  ready: 'Disponible',
  integrating: 'En integración',
  soon: 'Próximamente',
} as const;

export const SECURITY = [
  {
    title: 'Cada empresa ve solo lo suyo',
    text: 'El aislamiento entre empresas se aplica en la aplicación y, además, en la base de datos.',
  },
  {
    title: 'Credenciales cifradas',
    text: 'Las llaves de los portales de inversores se guardan cifradas y nunca se muestran ni se devuelven.',
  },
  {
    title: 'IA sin datos de contacto',
    text: 'La inteligencia artificial no recibe teléfonos, correos, domicilios ni credenciales de sus clientes.',
  },
  {
    title: 'Sus datos son suyos',
    text: 'Exporte toda la información de su empresa cuando quiera. Al terminar el servicio, se pueden borrar de forma definitiva.',
  },
] as const;

export const FAQ = [
  {
    q: '¿Tengo que cambiar los inversores o instalar algún equipo?',
    a: 'No. La plataforma lee los datos que el inversor ya envía al portal de su fabricante, con las llaves de acceso de ese portal.',
  },
  {
    q: '¿Qué pasa con las plantas de marcas que todavía no se conectan?',
    a: 'Se registran igual y aparecen en el mapa, el inventario y los tickets. Sus datos se leerán en cuanto esté lista la integración con su marca.',
  },
  {
    q: '¿Mis clientes entran a la plataforma?',
    a: 'Hoy la usan su empresa y sus técnicos. Sus clientes reciben el reporte mensual en PDF por correo, con su marca.',
  },
  {
    q: '¿Sirve para plantas con batería?',
    a: 'Sí. Puede marcarlas como plantas con batería o con límite de inyección a la red, para que una producción limitada a propósito no se confunda con suciedad o con una falla.',
  },
  {
    q: '¿Se puede usar desde el celular?',
    a: 'Sí. Todas las pantallas se adaptan al celular, pensadas para el técnico en campo.',
  },
  {
    q: '¿Qué significa PV-IoT?',
    a: NAME_MEANING,
  },
] as const;

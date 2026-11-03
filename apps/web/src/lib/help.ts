// Ayudas en pantalla (ícono ⓘ junto a cada dato): una explicación corta, en palabras simples.
// Los mismos conceptos se explican con más detalle en docs/glosario.md y docs/pantallas.md.
// Los números citados son los valores por omisión de specs/06 (cada empresa puede cambiarlos en
// Configuración → Alertas).

export const HELP = {
  // Tablero
  'dashboard.activePlants':
    'Plantas en operación de la empresa. Debajo: la potencia instalada total (kWp) y el número de clientes.',
  'dashboard.energyToday':
    'Energía que han generado todas las plantas hoy, sumando sus lecturas hasta la más reciente.',
  'dashboard.energyMonth':
    'Energía generada por todas las plantas desde el día 1 del mes hasta la última lectura.',
  'dashboard.pr7d':
    'Rendimiento de la flota en los últimos 7 días: energía real entre la energía que el clima permitía (corregida por temperatura). Entre 80 % y 90 % es normal.',
  'dashboard.openAlerts':
    'Alertas que siguen abiertas o vistas, por gravedad: críticas, advertencias y avisos.',
  'dashboard.map':
    'Cada punto es una planta. El color y la forma dicen su estado de hoy: Bien, Advertencia, Crítica, Sin datos o Sin métricas. Toque un punto para ver el detalle.',
  'dashboard.attention':
    'Las alertas abiertas más graves y recientes. Abra una para ver la explicación y crear un ticket.',
  'dashboard.cleanings':
    'Plantas que, según su tendencia de suciedad, cruzarán el umbral de pérdida (12 % bajo su normal) en los próximos 14 días. "Ya" significa que ya lo cruzaron.',
  'dashboard.ranking':
    'Las 5 plantas con mejor y peor rendimiento (PR corregido) de los últimos 30 días. Las peores son las primeras que conviene revisar.',
  'dashboard.ask':
    'Escriba una pregunta sobre su flota y el asistente de IA la responde con los datos de la plataforma.',

  // Planta
  'plant.status':
    'Estado de la planta hoy: Bien, Advertencia (rinde por debajo de lo normal o se acerca un lavado), Crítica (alerta grave), Sin datos (el inversor no reporta) o Sin métricas (aún no hay cálculo).',
  'plant.power': 'Potencia que entregaba el inversor en la última lectura (cada 15 minutos).',
  'plant.energyToday': 'Energía que la planta lleva generada hoy, hasta la última lectura.',
  'plant.pr7d':
    'Rendimiento de los últimos 7 días válidos: energía real entre la que permitían el sol y la temperatura. Más bajo de lo normal puede ser suciedad o una falla.',
  'plant.nextCleaning':
    'Días que faltan, según la tendencia de suciedad, para que la pérdida cruce el umbral de lavado. La confianza depende de qué tan clara es la tendencia.',
  'plant.todayChart':
    'Potencia real del día contra la esperada con el clima de hoy. Si la real queda muy por debajo con buen sol, algo está fallando.',
  'plant.prChart':
    'PR corregido de cada día contra su línea base (lo normal de la planta). Los días nublados o con pocos datos no cuentan (días no válidos).',
  'plant.soilingChart':
    'Qué tanto rinde la planta por debajo de lo normal desde el último lavado o lluvia, y la fecha estimada en que conviene lavar.',
  'plant.neighborsChart':
    'Rendimiento de la planta comparado con plantas cercanas de la misma empresa. Si todas bajan a la vez es el clima; si solo baja esta, es la planta.',

  // Alerta
  'alert.lastReading': 'Fecha y hora del último dato que mandó el inversor.',
  'alert.sunHoursWithoutData':
    'Horas con sol en las que el inversor no mandó datos. Con más de 4 se abre la alerta "Planta sin datos".',
  'alert.belowNormal':
    'Cuánto rindió por debajo de su línea base (lo normal de la planta) en el último día válido.',
  'alert.daysSinceCleaning':
    'Días desde el último lavado registrado o la última lluvia que limpió los paneles.',
  'alert.neighbors':
    'Rendimiento frente a plantas cercanas de la misma empresa: 100 % es igual que ellas; menos de 100 % es que esta planta rinde menos.',
  'alert.estimatedLoss':
    'Energía y dinero que se dejan de generar por día mientras el problema siga, con la tarifa del cliente. Es una estimación.',
  'alert.cause':
    'La causa más probable según la IA, con base en los datos de la alerta. Es una guía, no un diagnóstico.',
  'alert.confidence':
    'Qué tan segura es la explicación según los datos disponibles: baja, media o alta.',

  // Tickets
  'tickets.work':
    'Tiempo de trabajo: desde que el técnico presionó "Iniciar" hasta que lo resolvió. Promedio y mediana de los tickets resueltos en el periodo.',
  'tickets.wait': 'Espera: desde que se creó el ticket hasta que alguien lo inició.',
  'tickets.total': 'Tiempo total: desde que se creó el ticket hasta que se resolvió.',
  'tickets.median':
    'La mediana es el valor de en medio: la mitad de los tickets tardó menos y la mitad más. No la mueven los casos extremos.',
  'tickets.byAssignee': 'Tickets resueltos por cada responsable y su tiempo de trabajo promedio.',

  // Reportes
  'reports.status':
    'Sin generar · Generando (se calcula el PDF) · Generado (listo para revisar y enviar) · Enviado (llegó al correo del cliente) · Error.',
  'reports.narrative':
    'El texto del reporte lo redacta la IA con las cifras del mes. Si la IA no está disponible se usa un texto de plantilla con las mismas cifras.',
} as const;

export type HelpKey = keyof typeof HELP;

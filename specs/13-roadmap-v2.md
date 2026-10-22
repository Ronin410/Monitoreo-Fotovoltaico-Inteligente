# 13 — Roadmap v2 (fuera de alcance de la v1)

Funciones para ofrecer después como mejoras o servicios de mantenimiento. **No se implementan en la v1**, pero la arquitectura las permite sin rediseño. Están ordenadas por valor estimado para la instaladora.

| # | Función | Qué hace | Se apoya en |
|---|---------|----------|-------------|
| 1 | **Bot de WhatsApp para clientes finales** | El cliente pregunta "¿cuánto he ahorrado?" o "¿mi sistema está bien?" y recibe respuesta automática; también notificaciones de alertas por WhatsApp | WhatsApp Business API, mismas herramientas del chat con un alcance limitado a las plantas de ese cliente |
| 2 | **Cotizador para prospectos** | Estima la producción y el ahorro de un sistema nuevo usando el rendimiento real (kWh/kWp) de las plantas de la empresa en la misma zona | `plant_daily_metrics` por zona |
| 3 | **Costo-beneficio del lavado** | Recomienda cuándo conviene lavar comparando la pérdida acumulada (MXN) contra el costo del servicio y la probabilidad de lluvia | Predicción de lavado + pronóstico del clima |
| 4 | **Rutas de cuadrillas** | Agrupa tickets por zona y propone el orden de visita del día | Tickets + coordenadas |
| 5 | **Lectura de recibos CFE por foto** | Extrae consumo, tarifa y periodo para calcular el ahorro real | Modelo de visión |
| 6 | **Inspección por foto o dron** | Detecta suciedad, puntos calientes (termografía) y paneles dañados | Modelo de visión; almacenamiento de imágenes |
| 7 | **Pronóstico de generación** | Producción esperada de los próximos días por planta | Pronóstico de POA + modelo de la planta |
| 8 | **Portal del cliente final** | Acceso web de solo lectura para cada cliente | Nuevo rol `client_viewer` |
| 9 | **Benchmark anónimo entre empresas** | Comparar la zona contra el promedio anónimo de la plataforma | Requiere consentimiento explícito de las empresas y agregación anónima |
| 10 | **Facturación de la suscripción** | Planes y cobro dentro de la plataforma | Stripe o proveedor local |
| 11 | **Modo soporte para superadmin** | Ver datos de una empresa con su autorización, con auditoría | `audit_log` |

Cada función nueva debe tener su propio spec (`14-…`) antes de empezar.

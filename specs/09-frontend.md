# 09 — Frontend (apps/web)

## Principios
- Next.js App Router, Tailwind, lucide-react, Recharts, Leaflet.
- **Responsivo de verdad:** el operador usa escritorio y el técnico usa el celular. Ancho mínimo 360 px sin scroll horizontal; las tablas se convierten en tarjetas en pantallas angostas.
- Modo claro y oscuro.
- Marca blanca: el encabezado muestra el logo y el color de la empresa (`brand_color` como color de acento).
- Interfaz en español de México; números con formato `es-MX`; fechas en la zona horaria de la empresa.
- Colores de estado consistentes en toda la app: `ok` verde, `warning` ámbar, `critical` rojo, `offline` gris, `no_data` gris claro. Siempre acompañados de ícono o texto (no depender solo del color).
- Estados de carga (skeleton), vacío (con acción sugerida) y error en cada vista.

## Navegación (según rol)
`Tablero` · `Plantas` · `Clientes` · `Alertas` · `Tickets` · `Asistente IA` · `Reportes` · `Configuración`
El técnico solo ve `Mis tickets` (y el detalle de la planta de cada ticket).
El superadmin ve `Empresas` y `Salud del sistema`.

## Pantallas

### Autenticación
- Inicio de sesión, recuperar contraseña, aceptar invitación (definir contraseña).

### Tablero de flota
- Tarjetas: plantas activas, energía de hoy y del mes, PR corregido de los últimos 7 días, alertas abiertas (por severidad), plantas offline.
- **Mapa** (Leaflet + OpenStreetMap) con un marcador por planta coloreado por estado; al tocarlo se ve un resumen y un enlace al detalle.
- "Requieren atención": alertas críticas y de advertencia más recientes.
- "Próximos lavados": plantas con `days_to_cleaning ≤ 14`, con días estimados y confianza.
- "Mejores y peores": top 5 y bottom 5 por PR corregido de los últimos 30 días.
- Barra de pregunta rápida al asistente IA ("Pregúntale a tu flota…") que abre el panel del chat.

### Plantas (lista)
- Búsqueda por nombre de planta o cliente; filtros por estado, colonia, código postal y marca de inversor; orden por PR, desviación o días para lavado.
- Columnas: nombre, cliente, colonia, kWp, potencia actual, energía de hoy, PR 7 días, estado, días para lavado.

### Detalle de planta
- Encabezado: nombre, cliente, ubicación, kWp, inversor, estado, última lectura.
- **Hoy:** curva de potencia real contra potencia esperada (calculada con el clima) en la misma gráfica.
- **Rendimiento:** PR corregido diario de 30, 90 o 365 días con la línea base y el umbral de suciedad dibujados; marcadores de lluvia y de limpiezas.
- **Predicción de lavado:** días estimados, confianza y tendencia desde el último lavado o lluvia.
- **Comparación con vecinas:** índice frente a vecinas de los últimos 30 días.
- Alertas (con explicación IA), tickets y eventos de la planta.
- Acciones: crear ticket, registrar evento (limpieza, reparación, nota), editar, pausar.

### Clientes
- Lista y formulario: datos de contacto, dirección, colonia, código postal y selección de ubicación en el mapa (lat/lon), tarifa CFE, consumo mensual, correo para reportes.
- Detalle con sus plantas y reportes.

### Formulario de planta
- Datos técnicos con valores por defecto de la empresa (NOCT, γ, inclinación, orientación) y ayuda en línea que explica cada uno.
- Sección de credenciales del inversor **solo de escritura**: muestra "Credenciales guardadas el {fecha}" y botones "Reemplazar" y "Probar conexión".
- Para la marca `simulator`: editor sencillo de escenarios (solo en staging o empresas demo).

### Alertas
- Bandeja con filtros por estado, tipo, severidad y zona.
- Detalle: resumen IA destacado, causa probable, confianza, qué revisar, pérdida estimada en kWh y MXN por día, gráfica de la evidencia (últimos 14 días) y acciones: reconocer, crear ticket, descartar con motivo, regenerar explicación.

### Tickets
- Vista de lista y de tablero por estado.
- Formulario: tipo, prioridad, técnico, fecha programada.
- **Vista del técnico (celular):** tarjetas grandes con dirección (enlace a Google Maps con las coordenadas), qué revisar, botones de cambio de estado, notas y casilla "Se realizó limpieza".

### Asistente IA
- Lista de conversaciones a la izquierda (cajón en el celular) y chat a la derecha.
- Preguntas sugeridas en la conversación vacía.
- Renderizado de markdown, tablas y gráficas (`render_chart` → Recharts).
- Estados de herramienta mientras responde ("Consultando plantas en riesgo…").
- Indicador de uso del presupuesto mensual para el admin.

### Reportes
- Selector de mes; lista de clientes con estado del reporte (pendiente, generado, enviado, error).
- Vista previa del PDF, regenerar, enviar uno, enviar todos.

### Configuración (company_admin)
- Empresa: nombre, logo, color de marca, zona horaria.
- Umbrales de alertas (con valores por defecto y botón "Restablecer").
- Valores técnicos por defecto, tarifa por defecto, factor de CO₂.
- Correos para alertas, envío automático de reportes.
- Usuarios: invitar, cambiar rol, desactivar.
- Uso de IA del mes.

### Superadmin
- Empresas: crear (con invitación al primer admin), suspender, ver número de plantas y uso de IA.
- Salud del sistema: última ejecución de cada job, errores recientes de integraciones.

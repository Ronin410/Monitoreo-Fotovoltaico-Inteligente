# Guía de pantallas de PV-IoT

Qué hay en cada pantalla, qué explica y quién la ve. En la plataforma, junto a cada dato, el ícono **ⓘ** muestra una explicación corta (pase el mouse o tóquelo). Las palabras técnicas están en el [glosario](glosario.md).

## Roles

Cada usuario pertenece a una empresa y tiene un rol (el superadmin no pertenece a ninguna).

| Rol                                 | Quién es                                 | Qué hace                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Superadmin**                      | El equipo de PV-IoT                      | Da de alta empresas e invita a su primer administrador; cambia plan y presupuesto de IA; suspende empresas; revisa la salud del sistema. **No ve** plantas ni clientes de las empresas.                                                            |
| **Administrador** (`company_admin`) | Dueño o gerente de la instaladora        | Todo lo del operador, más: configurar la empresa (logo, color, umbrales de alertas, tarifas, correos) y gestionar usuarios (invitar, cambiar rol, desactivar). Ve el uso de IA del mes.                                                            |
| **Operador** (`operator`)           | Coordinador de operación o mantenimiento | Ve toda la flota: tablero, plantas, alertas. Da de alta clientes y plantas, captura credenciales de inversores, gestiona alertas, crea y asigna tickets, usa el asistente IA y genera y envía reportes. Ve los tiempos de atención de los tickets. |
| **Técnico** (`technician`)          | Personal de campo                        | Solo ve **sus tickets** (en el celular): dirección con mapa, teléfono del cliente, qué revisar. Presiona **Iniciar**, agrega notas, marca si hizo limpieza y **Resuelve**. No ve el resto de la flota.                                             |

| Puede…                                           | Superadmin | Administrador | Operador |    Técnico     |
| ------------------------------------------------ | :--------: | :-----------: | :------: | :------------: |
| Crear y suspender empresas                       |     ✅     |               |          |                |
| Configurar la empresa y sus usuarios             |            |      ✅       |          |                |
| Clientes y plantas (alta, edición, credenciales) |            |      ✅       |    ✅    |                |
| Ver tablero, plantas y alertas                   |            |      ✅       |    ✅    |                |
| Gestionar alertas, crear y asignar tickets       |            |      ✅       |    ✅    |                |
| Actualizar tickets                               |            |      ✅       |    ✅    | solo los suyos |
| Asistente IA                                     |            |      ✅       |    ✅    |                |
| Reportes a clientes                              |            |      ✅       |    ✅    |                |

Para dar de alta a una persona: **Configuración → Usuarios → Invitar** (le llega un correo para elegir su contraseña).

---

## Página pública (`/inicio`) — sin sesión

Presentación para interesados. Quien entra a la dirección principal sin sesión llega aquí; quien ya tiene sesión entra directo a su tablero.

- Secciones: beneficios, funciones, cómo funciona, marcas (con su estado real: disponible, en integración o próximamente), seguridad, preguntas frecuentes y contacto.
- Los botones "Solicitar una demostración" y "Escribir por WhatsApp" usan `NEXT_PUBLIC_CONTACT_EMAIL` y `NEXT_PUBLIC_CONTACT_WHATSAPP` (en `pv-web`). La plataforma no guarda datos de los interesados.
- Reglas del contenido: solo funciones que existen; sin precios, testimonios ni certificaciones; la vista previa del tablero dice "datos de ejemplo". Al cambiar el estado de una marca, actualice `apps/web/src/components/landing/landing-page.tsx`.

## Acceso (sin sesión)

- **Iniciar sesión** (`/login`): correo y contraseña. Después de 5 intentos fallidos por minuto hay que esperar.
- **Recuperar contraseña**: manda un enlace de un solo uso, válido por 1 hora. Siempre responde lo mismo, exista o no el correo.
- **Invitación** (`/invitacion/…`): la persona invitada escribe su nombre y elige su contraseña. La invitación vence en 7 días.
- **Aviso de privacidad** y **Términos de uso**: enlazados al pie de estas pantallas y en la barra lateral.
  - Se aceptan al crear la cuenta.
  - Quien ya tenía cuenta los acepta la primera vez que entra después de que cambien de versión.
  - Queda registrada la versión, la fecha y la IP.

## Tablero (`/`) — administrador y operador

El resumen de la flota al abrir la plataforma.

| Bloque                       | Qué muestra                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pregúntale a tu flota**    | Atajo al asistente IA con su pregunta.                                                                                                     |
| **Plantas activas**          | Plantas en operación, potencia instalada total (kWp) y número de clientes.                                                                 |
| **Energía de hoy / del mes** | Lo generado por toda la flota hoy y desde el día 1.                                                                                        |
| **PR corregido · 7 días**    | Qué tan bien aprovecha la flota el sol que recibe. Normal: 80–90 %.                                                                        |
| **Alertas abiertas**         | Cuántas hay, por severidad.                                                                                                                |
| **Mapa de plantas**          | Cada planta con su estado de hoy (color y forma): Bien, Advertencia, Crítica, Sin datos, Sin métricas. Toque un punto para ver su detalle. |
| **Requieren atención**       | Las 5 alertas abiertas más graves y recientes.                                                                                             |
| **Próximos lavados**         | Plantas que cruzarán el umbral de suciedad en 14 días, con su confianza. "Ya" = ya lo cruzaron.                                            |
| **Mejores y peores**         | Las 5 plantas con mejor y peor PR de los últimos 30 días.                                                                                  |

## Plantas (`/plants`)

**Importar desde Excel** (`/plants/import`): para dar de alta muchos clientes y plantas a la vez.

1. Descargue la plantilla. Cada renglón es una planta con los datos de su cliente.
2. Llénela en Excel y guárdela como **CSV UTF-8**.
3. Use **Revisar archivo**: no guarda nada y señala cada problema con su renglón y columna.
4. Use **Importar**: guarda todo junto, o nada si hay algún error.

Los clientes que ya existen (mismo nombre) no se modifican; la planta se les agrega. Una planta con el mismo nombre que otra del mismo cliente se reporta como repetida.

**Lista:** búsqueda y filtros (estado, código postal, colonia, marca), ordenar por nombre o por métricas (PR de 7 días, desviación, días para lavado).

**Detalle de una planta:**

- Tarjetas: **Estado**, **Potencia actual**, **Energía de hoy**, **PR corregido · 7 días**, **Próximo lavado**.
- **Hoy: potencia real y esperada:** si la línea real queda muy debajo de la esperada con buen sol, algo falla.
- **Rendimiento diario (PR corregido):** cada día contra su línea base; los días no válidos se marcan aparte.
- **Predicción de lavado:** la tendencia de pérdida desde el último lavado o lluvia y la fecha estimada para lavar.
- **Comparación con vecinas:** si todas las cercanas bajan es el clima; si solo esta, es la planta.
- **Eventos:** lavados, reparaciones, cambios de inversor, notas (se pueden registrar a mano).
- **Credenciales del inversor:** se capturan y se prueban; nunca se vuelven a mostrar.
- **Actividad:** sus alertas y tickets.

### Cómo llenar el formulario de planta

| Campo                                                  | Qué poner                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cliente**                                            | El dueño de la planta (créelo antes en Clientes).                                                                                                                                                                                                                                                 |
| **Nombre de la planta**                                | Un nombre para reconocerla, por ejemplo "Casa Pérez" o "Bodega Norte".                                                                                                                                                                                                                            |
| **Capacidad (kWp)**                                    | Suma de la potencia de los paneles: número de paneles × watts de cada uno ÷ 1000. Ej.: 12 paneles de 550 W = 6.6 kWp.                                                                                                                                                                             |
| **Puesta en marcha**                                   | Fecha en que empezó a generar.                                                                                                                                                                                                                                                                    |
| **Estado**                                             | Activa, Pausada (no se monitorea ni da alertas) o Dada de baja.                                                                                                                                                                                                                                   |
| **Marca, modelo y número de serie del inversor**       | Están en la etiqueta del inversor. La marca decide cómo se leen sus datos ("Simulador (demo)" solo en pruebas).                                                                                                                                                                                   |
| **Modelo y número de paneles**                         | De la hoja técnica o la cotización.                                                                                                                                                                                                                                                               |
| **Tiene batería / Tiene límite de inyección a la red** | Márquelas si la planta tiene batería, o si el inversor no puede mandar a la red todo lo que produce (cero exportación o un tope). En esas plantas el inversor baja la producción a propósito, así que la plataforma no da alertas de suciedad ni de caída de rendimiento (las de "sin datos" sí). |
| **Inclinación (°)**                                    | Ángulo de los paneles: 0° plano; en Sinaloa suelen ir entre 10° y 25°.                                                                                                                                                                                                                            |
| **Orientación (°)**                                    | Hacia dónde ven: 180° sur (lo ideal), 90° este, 270° oeste.                                                                                                                                                                                                                                       |
| **NOCT (°C) y coeficiente γ (%/°C)**                   | De la hoja técnica del panel. Si no los tiene, deje los valores por omisión (45 °C y −0.4 %/°C).                                                                                                                                                                                                  |
| **Latitud / longitud**                                 | Ubicación en el mapa (elíjala en el mapa del formulario). Se usa para el clima y las vecinas.                                                                                                                                                                                                     |
| **Colonia y código postal**                            | Para agrupar por zona y comparar con vecinas.                                                                                                                                                                                                                                                     |

## Clientes (`/clients`) — administrador y operador

**Lista** con búsqueda, y **detalle** con sus plantas y reportes.

### Cómo llenar el formulario de cliente

| Campo                                                         | Qué poner                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Nombre o razón social**                                     | Persona o negocio dueño del sistema.                                                                    |
| **Persona de contacto, teléfono, correo**                     | A quién llamar para coordinar visitas. El técnico ve el teléfono en sus tickets.                        |
| **Dirección, colonia, código postal, ciudad, estado**         | El domicilio donde está instalado.                                                                      |
| **Latitud / longitud**                                        | Ubicación en el mapa.                                                                                   |
| **Tarifa CFE**                                                | La del recibo (por ejemplo 1F, DAC, PDBT).                                                              |
| **Precio por kWh (MXN)**                                      | Lo que paga por kWh; si se deja vacío se usa el de la empresa. Calcula el ahorro y la pérdida estimada. |
| **Consumo mensual promedio (kWh)** y **recibo mensual (MXN)** | Del recibo de CFE. Permiten decir qué parte de su consumo cubre el sistema.                             |
| **Correo para reportes**                                      | A dónde se manda el reporte mensual en PDF. Sin correo, el reporte se genera pero no se puede enviar.   |

## Alertas (`/alerts`) — administrador y operador

**Bandeja** con filtros por estado, tipo, severidad y código postal.

**Detalle de una alerta:**

- **Explicación (IA):** resumen, **causa probable**, **confianza**, otras causas y **qué revisar**. Si la IA no está disponible se usa una plantilla.
- **Datos clave:**
  - última lectura y horas de sol sin datos (para "Planta sin datos");
  - cuánto está debajo de su normal, días desde el último lavado y comparación con sus vecinas;
  - **pérdida estimada** por día, en kWh y pesos.
- **Gráfica de evidencia**: los días que dispararon la alerta.
- **Acciones:**
  - **Reconocer** (marcarla como vista).
  - **Crear ticket**, con los datos ya llenos.
  - **Descartar**, con un motivo obligatorio.
  - **Regenerar explicación**, hasta 3 veces al día.

## Tickets (`/tickets`)

**Administrador y operador:**

- **Tiempos de atención** (últimos 7, 30 o 90 días):
  - **tiempo de trabajo**: de "Iniciar" a "Resolver", en promedio y mediana;
  - **espera antes de iniciar** y **tiempo total**;
  - **resueltos** y **en curso**;
  - una tabla **por responsable**.
- **Lista** (filtros por estado, tipo y responsable) o **tablero** por columnas (Pendiente, Programado, En curso). En la lista, cada ticket muestra su tiempo de trabajo o cuánto lleva en curso.
- **Nuevo ticket** (también desde una alerta o una planta).

**Técnico (celular):** tarjetas grandes con sus tickets: dirección con enlace a Google Maps, teléfono del cliente, qué revisar, y los botones **Iniciar**, **Resolver** (con notas y "se realizó limpieza").

**Detalle del ticket:**

- dónde es y qué revisar;
- responsable, fecha programada, creado, **iniciado** y **tiempo de trabajo** (o "en curso desde hace…");
- la alerta de origen y la gráfica de potencia de hoy.

Resolver con **limpieza** registra un lavado: reinicia la tendencia de suciedad, y la alerta se cierra sola si los datos confirman que la planta se recuperó.

## Asistente IA (`/assistant`) — administrador y operador

- Conversaciones a la izquierda (cajón en el celular) y el chat a la derecha.
- Preguntas sugeridas para empezar. Responde con tablas, gráficas y enlaces a las plantas.
- Muestra qué está consultando mientras responde ("Consultando plantas en riesgo…").
- Límite: 30 preguntas por hora por usuario y el presupuesto mensual de IA de la empresa.

## Reportes (`/reports`) — administrador y operador

- Selector de mes (meses ya terminados).
- Un renglón por cliente con planta activa ese mes. Cada reporte pasa por estos estados:

  | Estado      | Qué significa                   |
  | ----------- | ------------------------------- |
  | Sin generar | Aún no se crea el reporte.      |
  | Generando   | Se está calculando el PDF.      |
  | Generado    | Listo para revisar y enviar.    |
  | Enviado     | Llegó al correo del cliente.    |
  | Error       | Algo falló al generar o enviar. |

- **Ver PDF** (vista previa).
- **Generar / Regenerar**: un reporte enviado ya no se regenera.
- **Enviar** a un cliente, o **Enviar todos** con confirmación.
- "Texto de plantilla" indica que la narrativa no la redactó la IA.

## Configuración (`/settings`) — administrador

| Pestaña              | Qué se configura                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empresa**          | Nombre, logo (PNG/JPG/SVG), color de marca, zona horaria.                                                                                                                                                                 |
| **Alertas**          | Los umbrales: suciedad (12 %, 3 días), caída brusca (40 %), horas sin datos (4), lluvia que lava (2 mm), día válido (2.0 kWh/m², 80 % de datos), vecinas (5 km, mínimo 3), evento de zona (60 %). Botón **Restablecer**.  |
| **Valores técnicos** | Valores por omisión para plantas nuevas (NOCT, γ, inclinación, orientación), tarifa por kWh y factor de CO₂.                                                                                                              |
| **Notificaciones**   | Correos extra que reciben las alertas y el envío automático de reportes el día 1.                                                                                                                                         |
| **Usuarios**         | Invitar, cambiar rol, desactivar o reactivar.                                                                                                                                                                             |
| **Uso de IA**        | Tokens del mes por función (chat, explicaciones, reportes) contra el presupuesto.                                                                                                                                         |
| **Integraciones**    | Llaves de GoodWe de la empresa (Client ID, Client Secret y servidor), que GoodWe entrega a la instaladora al aprobar su acceso. Se guardan cifradas y no se vuelven a mostrar. Botones Probar conexión, Cambiar y Borrar. |
| **Exportar datos**   | Prepara un ZIP con todos los datos de la empresa en hojas CSV que se abren en Excel (sin contraseñas ni credenciales de inversores). Tarda unos minutos; se descarga la última durante 7 días.                            |

## Superadmin

- **Empresas** (`/admin/companies`): cada tarjeta muestra el número de plantas y el uso de IA del mes, con estas acciones:
  - **Nueva empresa**, que manda la invitación a su primer administrador.
  - **Plan y presupuesto** de IA (en tokens; 2,000,000 es lo normal).
  - **Reenviar invitación**.
  - **Cargar datos de ejemplo** (solo en pruebas y con la empresa vacía).
  - **Suspender / Reactivar**.
  - **Borrar definitivamente** (solo una empresa suspendida): borra la empresa y todos sus datos y archivos, sin vuelta atrás. Se confirma escribiendo su identificador y avisa si su administrador nunca exportó sus datos.
- **Salud del sistema** (`/admin/health`): última ejecución de cada proceso automático (lectura de inversores, clima, cálculos, alertas, correos, reportes) y fallas de las últimas 24 horas.

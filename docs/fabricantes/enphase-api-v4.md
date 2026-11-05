# Enphase — API v4 (revisión de la documentación oficial)

**Fuentes (leídas el 2026-11-05):**

1. Portal oficial `https://developer-v4.enphase.com/`: guía de inicio (`/docs/quickstart.html`), Monitoring API (`/docs/monitoring_api`) y planes (`/installer-plans`, `/developer-plans`).
2. La especificación Swagger 2.0 que publica el mismo portal (`/swagger/spec/System_API.json`), guardada sin cambios en `docs/fabricantes/enphase-monitoring-api-v4.json`. Trae `host: api-qa2.enphaseenergy.com` (entorno de pruebas de Enphase); la guía usa `https://api.enphaseenergy.com` para producción.

Los valores de ejemplo de la guía (client_id, códigos, tokens) son de muestra y no se usan.

## 1. Acceso

| Tema                | Información oficial                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tipo de API         | REST, JSON sobre HTTPS, OAuth 2.0                                                                                                                                                                            |
| Cada petición lleva | `Authorization: Bearer <access_token>` y el encabezado `key` con la API key de la aplicación                                                                                                                 |
| Plan para PV-IoT    | **Partner**: solo instaladores registrados en Enphase con **al menos 10 instalaciones**. Da acceso a todos los sistemas que la instaladora instaló o mantiene. Requiere tarjeta de crédito en el portal      |
| Credenciales        | Al crear la aplicación Partner se generan **API key, Client ID y Client Secret**. La aplicación queda pendiente hasta que Enphase la verifica                                                                |
| Token               | `POST https://api.enphaseenergy.com/oauth/token` con `grant_type=password`, el correo y la contraseña de Enlighten de la instaladora, y Basic `client_id:client_secret`. Se recomienda enviarlo en el cuerpo |
| Vigencia            | `access_token` 1 día; `refresh_token` 1 mes. Con `grant_type=refresh_token` se obtienen ambos de nuevo (el refresh token cambia)                                                                             |
| Límites (Partner)   | 300 peticiones por minuto y 1,500,000 al mes. Respuesta `429` al excederse                                                                                                                                   |
| Costo (Partner)     | 10,000 peticiones gratis al mes; **USD 0.005** por petición adicional; USD 0.10 por consulta de estado en vivo (`live_data`)                                                                                 |
| Contacto            | `api@enphaseenergy.com`                                                                                                                                                                                      |

Los planes Watt, Kilowatt y Megawatt son para desarrolladores o propietarios: cada dueño debe autorizar la aplicación (flujo `authorization_code`). No encajan con PV-IoT, donde la instaladora administra muchas plantas.

## 2. Funciones relevantes (solo lectura)

| Función                                                       | Para qué                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v4/systems` (`page`, `size` ≤ 100)                  | Lista de sistemas: `system_id`, `name`, `timezone`, dirección, `status`, `last_report_at`. Sirve para vincular plantas y para "Probar conexión"                                             |
| `GET /api/v4/systems/{system_id}/telemetry/production_micro`  | Producción de todos los microinversores. Con `granularity=day`, hasta **288 intervalos de 5 min**: `end_at` (epoch, fin del intervalo), `powr` (W medios), `enwh` (Wh), `devices_reporting` |
| `GET /api/v4/systems/{system_id}/telemetry/production_meter`  | Medidor de producción (si el sistema lo tiene). Con `granularity=day`, hasta **96 intervalos de 15 min**: `end_at`, `wh_del` (Wh), `devices_reporting`                                      |
| `GET /api/v4/systems/{system_id}/energy_lifetime`             | Energía diaria en **Wh**, sin huecos. Sirve para la validación diaria contra el total del fabricante (`specs/14` D4)                                                                        |
| `GET /api/v4/systems/{system_id}/summary`, `/devices`         | Datos del sistema y sus equipos                                                                                                                                                             |
| `GET /api/v4/systems/{system_id}/open_events`, `/open_alarms` | Eventos y alarmas abiertas (para el futuro)                                                                                                                                                 |

Reglas de la telemetría: sin `start_at` empieza a la medianoche **en la zona horaria del sistema**; el inicio debe estar dentro de los últimos 2 años; la respuesta termina en la hora de la petición si el periodo no ha acabado.

`status` del sistema usa los valores de la tabla de la documentación (`normal`, `comm` "Envoy no reporta", `micro`, `power` "problema de producción", `meter`, etc.).

**No se usan:** la Commissioning API (activaciones, usuarios, modo de producción), la configuración de baterías (`PUT battery_settings`), el control de cargadores y la VPP API. PV-IoT solo lee datos.

## 3. Cómo encaja con PV-IoT

- **Credenciales por empresa**, como GoodWe y Growatt: API key, Client ID, Client Secret y la cuenta de Enlighten de la instaladora, en **Configuración → Integraciones**, cifradas.
- **Costo por petición.** Consultar cada planta cada 15 minutos son unas 2,880 peticiones al mes por planta: con 50 plantas, unas 144,000 peticiones, unos **USD 670 al mes**. En cambio, una consulta por planta y por día (`granularity=day` trae el día completo) son unas 30 al mes por planta: 50 plantas caben en las 10,000 gratis.
- **Frecuencia (decisión del PO, 2026-11-05): cada 2 horas con sol**, más una lectura justo al cerrar la ventana de sol para tener la tarde completa antes del cálculo de las 22:00. Son unas 8 consultas por planta al día (unas 240 al mes): 50 plantas son unas 12,000 al mes, unos USD 10 sobre lo gratuito. Cada consulta trae el día completo, así que no se pierden intervalos. La alerta "sin datos" (4 horas con sol) sigue funcionando: entre lecturas pasan como máximo 2 horas. Ya está en la ingesta: `pollEveryMinutes` del adaptador e `isPollSlot` en `packages/core`.
- **Serie de 15 minutos:** con medidor, `wh_del` ya viene cada 15 min (kW = Wh × 4 / 1000). Sin medidor, se suman tres intervalos de 5 min de `enwh`. Los timestamps son de **fin** de intervalo; PV-IoT guarda el inicio, así que se resta la duración.
- **Requisito en campo:** el sistema debe estar dado de alta en Enlighten y reportando con su Envoy.

## 4. Implementación (2026-11-05)

- **Credenciales (decisión del PO, #224):** se guarda cifrada la cuenta de Enlighten (correo y contraseña) junto con la API key, el Client ID y el Client Secret, en `company_integrations`. Con ella la plataforma pide un token nuevo cuando vence (cada día), sin que la instaladora tenga que volver a capturar nada.
- Cliente: `packages/adapters/src/integrations/enphase.ts`. El token se guarda solo en memoria del proceso y se comparte entre las plantas de la misma cuenta. Con 401 se pide uno nuevo una vez; 429 hace que el job reintente.
- Adaptador: `packages/adapters/src/inverters/enphase.ts`. Cada planta guarda su `system_id`. Lee `telemetry/production_micro` (un día por consulta) y suma los tres intervalos de 5 min de cada cuarto de hora. Un cuarto de hora incompleto no se entrega, para no confundir un hueco con producción baja.
- Sin la cuenta de la empresa, la planta se omite (`no_integration`) y cuenta como problema de conexión, no como planta sin datos.
- Pantallas: **Configuración → Integraciones → Enphase** y, en cada planta, el número de sistema.
- Las pruebas usan respuestas con la forma de los ejemplos de la especificación oficial. Falta validarlas con una cuenta real.

## 5. Pendientes (ver `specs/PREGUNTAS.md` #222 y #224)

1. Confirmar que la empresa cumple el requisito del plan Partner (10 instalaciones Enphase) y que acepta el costo por petición.
2. Con una cuenta real: confirmar el servidor de producción (`api.enphaseenergy.com`), la zona horaria, que `end_at` es el fin del intervalo y que los intervalos sin producción vienen con 0 (si no vienen, los cuartos de hora de madrugada y atardecer contarían como faltantes).
3. Sistemas con medidor de producción: hoy se usa la suma de los microinversores. Se puede cambiar a `telemetry/production_meter` si se prefiere la lectura del medidor.

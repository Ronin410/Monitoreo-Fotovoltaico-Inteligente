# GoodWe — OpenAPI de SEMS (revisión de la documentación)

**Fuente:** portal oficial https://openapi.goodwe.com. La especificación OpenAPI 3.0 (`developerplatform-en-US.json`) la sirve el portal desde `iot-sgp.oss-ap-southeast-1.aliyuncs.com`. Descargada el 2026-11-03; la entregó el equipo. Las guías tienen fechas de actualización de mayo a septiembre de 2026.

Este documento resume solo lo que dice la documentación. Lo que falta o se contradice queda en el §6 (`CLAUDE.md`: no se suple con supuestos).

## 1. Acceso: hay que solicitarlo a GoodWe

No es una API abierta: GoodWe revisa una solicitud y entrega un **Client ID** y un **Client Secret**. Hay dos caminos.

| Camino                                | Para quién (según GoodWe)                                                                                                           | Qué se entrega                                                                                                                                     | Cómo se autentica                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Usuario de organización**           | Distribuidores, **instaladores** y clientes ODM que **ya tienen cuenta de organización en SEMS o SEMS+**                            | Código de organización en SEMS+, cuenta registrada (correo, fuera de China) y razón social. Según el país, puede pedirse firmar acuerdos de datos. | **Client credentials**: `POST {BaseUrl}/goodwe/goodwe-authorization-server/oauth2/token` con `Authorization: Basic base64(client_id:client_secret)` y `grant_type=client_credentials`. El token dura **3,600 s**; GoodWe recomienda renovarlo a los ~50 min. **Solo un token activo por Client ID**: pedir uno nuevo invalida el anterior. |
| **Tercero** (plataformas como PV-IoT) | Operadores de plantas virtuales (VPP), empresas de servicios de energía y otros terceros que monitorean plantas de usuarios finales | Razón social, correo, nombre, descripción e ícono de la aplicación, y la URL de retorno (OAuth) o el texto del acuerdo (lista blanca).             | **OAuth 2.0 con código de autorización y PKCE**: cada dueño de planta inicia sesión en GoodWe y autoriza. Token de acceso de 24 h y de renovación de 30 días; alcance `openapi:plant:data-access` para lectura. Alternativa: **lista blanca** de números de serie, que el dueño confirma en la app SEMS+.                                  |

**Decisión del PO (2026-11-03): camino de usuario de organización.** Antes de decidirlo, el análisis era: para PV-IoT, el camino natural es que **cada instaladora** solicite acceso como _usuario de organización_ con su cuenta de SEMS+ y capture en la plataforma su Client ID y Client Secret. Así no se pide autorización a cada cliente final. La otra opción es que PV-IoT se registre como _tercero_ y cada cliente final autorice con OAuth. Es una decisión de negocio: ver §6.

## 2. Datos generales

| Tema             | Lo que dice la documentación                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidores       | Según dónde estén registradas las plantas: Europa `https://eu-gateway.semsportal.com`, América `https://us-gateway.semsportal.com`, Australia `https://au-gateway.semsportal.com`, internacional `https://hk-gateway.semsportal.com`, China `https://gateway.sems.com.cn` |
| Encabezados      | `Authorization: Bearer {access_token}` y `Request-Id` (obligatorio; la documentación no explica su formato)                                                                                                                                                               |
| Formato          | Todas las consultas son `POST` con JSON. Respuesta `{ code, msg, data }`; `code = "00000"` es éxito.                                                                                                                                                                      |
| Límite de uso    | Existe el error `00003` ("la frecuencia de peticiones excede el límite"), pero **no se publica el límite**.                                                                                                                                                               |
| Errores de token | `10000` sin token, `10001` formato inválido, `10002` token vencido.                                                                                                                                                                                                       |

## 3. Funciones que usaría la plataforma

| Para qué                         | Función (`POST`)                                      | Notas de la documentación                                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listar plantas de la cuenta      | `/goodwe/integration/api/v1/base-info/plants`         | Paginado (10 a 100). Busca por nombre, ID, NMI o **número de serie del inversor**. Devuelve `plantId`, `plantName`, `plantStatus` (−1 sin conexión, 0 en espera, 1 generando, 2 falla), `timeZone`, `pvCapacity` (kW) y, en el ejemplo, `latitude` y `longitude`. |
| Equipos de una planta            | `/goodwe/integration/api/v1/base-info/plant/devices`  | Número de serie y tipo de cada equipo (0 inversor a red, 1 inversor con batería, 3 microinversor, 4 todo en uno…).                                                                                                                                                |
| Potencia actual de la planta     | `/goodwe/integration/api/v1/realtime/plants`          | Hasta 100 plantas por consulta. `pvPower` en **kW**, `refreshTime` en ms UTC.                                                                                                                                                                                     |
| **Serie histórica de la planta** | `/goodwe/integration/api/v1/realtime/plants/history`  | Hasta 100 plantas, **ventana de 24 h como máximo**, **intervalo de 1 minuto** (el único disponible). `startTime` y `endTime` en **segundos UTC**. `pvPower` en kW.                                                                                                |
| Serie histórica del inversor     | `/goodwe/integration/api/v1/realtime/devices/history` | Hasta 10 equipos del mismo tipo, 24 h, 50 puntos. **Solo datos desde el 1 de enero de 2025.** `pvPower` (kW), `dailyGeneration` (kWh) y `totalGeneration` (kWh) tienen historial; `innerTemperature` (°C) **no** lo tiene en inversores a red.                    |
| Energía diaria                   | `/goodwe/integration/api/v1/statistics/plants`        | Granularidad día, mes o año (máximo 31 días o 12 meses). `pvGeneration` en kWh, **medida del lado de corriente directa (DC)**.                                                                                                                                    |
| Alarmas del inversor             | `/goodwe/integration/api/v1/alarm/inverters`          | Hasta 50 equipos, ventana máxima de 30 días. Código, nombre, estado, y hora de inicio y de recuperación en ms. Ejemplo: `E-G3-0-12` "Grid Waveform Abnormal".                                                                                                     |

## 4. Cómo encaja con PV-IoT

- **Ingesta cada 15 min:** con `realtime/plants/history` (1 punto por minuto, en kW) se promedian los minutos de cada intervalo de 15 min para obtener `power_kw`. Se pueden pedir **hasta 100 plantas en una consulta**, así que conviene una consulta por instaladora, no una por planta.
- **Energía del día:** `dailyGeneration` del inversor (`devices/history`). La de `statistics/plants` es del lado DC, no la de corriente alterna (AC) que entrega el inversor; no conviene mezclarlas en el PR.
- **Identificar la planta:** cada planta de PV-IoT guarda el `plantId` de GoodWe; también se puede buscar por el número de serie del inversor, que la plataforma ya registra.
- **Credenciales por empresa, no por planta:** con el camino de _usuario de organización_, el Client ID y el Client Secret son de la instaladora y sirven para todas sus plantas. Hoy PV-IoT guarda credenciales por planta (cifradas). Hay que agregar credenciales por empresa, también cifradas.
- **Un solo token activo por Client ID:** el worker debe compartir un mismo token por instaladora entre todos sus procesos (pedir uno nuevo invalida el anterior) y renovarlo antes de una hora.
- **Alertas:** las alarmas del inversor pueden alimentar la regla de "inversor con falla".

## 5. Lo que sí se puede programar ya

- El cliente HTTP: elegir el servidor, el token por _client credentials_ compartido y renovado, `Request-Id`, validación con zod de `{ code, msg, data }` y manejo de `00003` y `10002`.
- Convertir la serie de 1 minuto a intervalos de 15 min. Es una función pura, con pruebas basadas en los ejemplos de la documentación.
- "Probar conexión": pedir el token y consultar `base-info/plants`.

## 6. Pendientes (ver `specs/PREGUNTAS.md` #213)

1. **Decisión del PO:** ¿cada instaladora solicita su acceso como _usuario de organización_ (credenciales por empresa) o PV-IoT se registra como _tercero_ (OAuth de cada cliente final)? De esto depende cómo se capturan las credenciales.
2. **Límite de peticiones:** no está publicado; hay que pedirlo a GoodWe.
3. **Formato de `Request-Id`:** es obligatorio, pero no se explica (¿un UUID por petición?).
4. **Contradicciones de la documentación**, a confirmar con una cuenta real:
   - En el ejemplo de `realtime/devices`, `pvPower` viene como texto `"4500.5"`, que parece en W, aunque el anexo dice kW.
   - En `realtime/plants/history`, el esquema dice que `plantData` es una lista y el ejemplo lo muestra como objeto con el `plantId` como llave. Los valores vienen como texto (`"0.001"`).
   - En `alarm/inverters`, la descripción no aclara si las fechas van en segundos o en ms; el ejemplo usa ms.
   - `timeZone` es un número (por ejemplo `5.0`, `-8`); falta confirmar si son horas de diferencia con UTC.
5. **Región de México:** confirmar con GoodWe en qué servidor quedan las plantas de México (probablemente `us-gateway` o `hk-gateway`).
6. **Datos anteriores a 2025:** el historial por equipo solo existe desde el 1 de enero de 2025; para plantas más antiguas solo hay estadística diaria.

Con la aprobación de GoodWe y una cuenta con al menos una planta, los puntos 3 y 4 se resuelven en una prueba, y sus respuestas se graban como ejemplos para las pruebas automáticas.

# Growatt — OpenAPI (revisión de la información oficial)

**Fuentes:**

1. Respuesta del **soporte de Growatt México** a la empresa (PDF "Info_GROWATT", entregado por el equipo el 2026-11-05).
2. La documentación oficial que ese correo indica, en ShowDoc: `https://www.showdoc.com.cn/262556420217021/1494053950115877`. **Leída el 2026-11-05** con un navegador (ShowDoc rechaza las descargas automáticas). Se revisaron las 18 páginas clave; el resumen está en §4.
3. Como contexto, no como fuente: la librería comunitaria GrowattServer (`indykoning/PyPi_GrowattServer`, `docs/openapiv1.md`). No es de Growatt y no se programa con ella (`CLAUDE.md`).

La página de ShowDoc muestra un "token de prueba" público. **No se usa**: solo se probará con el token de la empresa.

## 1. Lo que dice el soporte de Growatt

| Tema               | Información oficial                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo de API        | REST sobre HTTPS, con autenticación basada en OAuth 2.0                                                                                                                                                                             |
| Autenticación      | Encabezado `token` con el token de acceso de la cuenta. **No hay** esquema de App Key / Secret                                                                                                                                      |
| Servidores         | Pruebas: `test.growatt.com/v1/`. Producción: `https://openapi.growatt.com`                                                                                                                                                          |
| Cómo se obtiene    | Se solicita en la plataforma OSS (`https://oss.growatt.com/`). Requiere **cuenta de tipo instalador**, y que los equipos estén ligados a una planta con su datalogger y la app ShinePhone                                           |
| Seguimiento formal | `mx.service@growatt.com` (soporte de México)                                                                                                                                                                                        |
| Códigos de error   | `0` sin error; `10011` sin permiso; `10012` **límite de tasa**; `10013` más de 100 registros por página; `10014` más de 250 páginas                                                                                                 |
| **Límite de tasa** | "Las solicitudes están limitadas a **una cada cinco minutos**." Algunas funciones tienen además cuota diaria: `/v1/plant/list` (plantas de todos los usuarios de la cuenta principal) **una vez cada 5 minutos y máximo 10 al día** |
| Recomendación      | Caché local, paginación controlada e intervalo de consulta conservador                                                                                                                                                              |

## 2. Cómo encaja con PV-IoT

- **Credenciales por empresa, como GoodWe.** El token es de la cuenta de instalador y ve las plantas de sus clientes. Va en **Configuración → Integraciones** (`company_integrations`), cifrado. Según la documentación, el token no caduca mientras el usuario no lo revoque.
- **El límite de tasa se resuelve con consultas por lotes.** Las funciones de datos en tiempo real aceptan **hasta 100 inversores del mismo tipo por petición** (`invs_data` para tipo 1, `tlxs_data` para tipo 7 MIN, y equivalentes para SPH, MAX y SPA). Así basta **una petición por empresa y por tipo de equipo cada 15 minutos**, dentro de "una cada cinco minutos" por función.
- **Qué se guarda cada 15 minutos:** la potencia instantánea (`pac`) y, donde exista, la energía del día (`eacToday`). La energía del intervalo se obtiene de la diferencia del contador, igual que con otras marcas (`normalizeReadings`).
- **Huecos y recuperación:** `/v1/plant/power` entrega la serie del día cada 5 minutos en W; sirve para rellenar huecos sin depender de la lectura en tiempo real.
- **Identificación de la planta:** por el número de serie del inversor (`device_sn`) y su tipo, que se obtienen de `/v1/device/list`. El tipo decide a qué función por lotes va cada equipo.
- **Requisito en campo:** cada equipo debe estar ligado a una planta en ShinePhone con su datalogger. Sin eso no aparece en la API.

## 3. Pendientes (ver `specs/PREGUNTAS.md` #220 y #221)

1. ~~Leer la documentación de ShowDoc.~~ Hecho (§4).
2. Confirmar con Growatt si el límite de "una cada cinco minutos" es **por función y por token** (así lo sugiere la documentación) o global por cuenta.
3. **Servidor para México:** el soporte indica `openapi.growatt.com`; la documentación lista `openapi-us.growatt.com` (y `oss-us`) para Norteamérica. Confirmar cuál corresponde a las cuentas de la empresa.
4. **Unidades y zona horaria:** para MIN (tipo 7) no se indica la unidad de `pac` ni de `eacToday` (para tipo 1, `pac` está en W). Tampoco se indica la zona horaria de `time` y `calendar`; el historial de MIN acepta `timezone_id`. Se resolverá con respuestas reales.
5. "Probar conexión" **no debe usar** `/v1/plant/list` (máximo 10 al día); usar una función sin cuota diaria, por ejemplo `/v1/device/list` de una planta.
6. Obtener el token en OSS con la cuenta de instalador, más al menos una planta reportando, para grabar respuestas reales como ejemplos de prueba.

## 4. Funciones relevantes (documentación oficial)

Todas llevan el encabezado `token`. La respuesta tiene la forma `{ data, error_code, error_msg }`. Un `error_code` de `-1` indica usar el dominio nuevo (`server.growatt.com` → `openapi.growatt.com`; `server-us` → `openapi-us`).

### Plantas

| Función                                       | Parámetros                                                         | Datos útiles                                                                                | Límite                  |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /v1/plant/list`                          | `page`, `perpage` (≤ 100)                                          | `plant_id`, `peak_power` (kWp), `current_power` (W), `total_energy` (kWh), latitud/longitud | 1 cada 5 min, 10 al día |
| `GET /v1/plant/details`, `GET /v1/plant/data` | `plant_id`                                                         | Información básica y resumen de la planta                                                   | —                       |
| `GET /v1/plant/energy`                        | `plant_id`, `time_unit` (day/month/year), rango ≤ 7 días en diario | Energía en kWh                                                                              | 10 al día               |
| `GET /v1/plant/power`                         | `plant_id`, `date`                                                 | Serie cada 5 min: `time` ("YYYY-MM-DD HH:mm") y potencia en W                               | 1 cada 5 min            |

### Equipos

| Función                                                             | Parámetros                              | Datos útiles                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/device/list`                                               | `plant_id`                              | `device_sn`, `datalogger_sn`, `model`, `type`, `last_update_time`, `lost`                                           |
| `POST /v1/device/inverter/invs_data`                                | `inverters` (≤ 100 SN), `pageNum` (≤ 2) | Solo tipo 1. `pac` (W), `ppv` (W), `temperature` (°C), `status` (0 espera, 1 normal, 3 falla), `time`. 1 cada 5 min |
| `POST /v1/device/tlx/tlxs_data`                                     | `tlxs` (≤ 100 SN), `pageNum` (≤ 2)      | Solo tipo 7 (MIN). `pac`, `ppv`, `eacToday`, `eacTotal`, `temp1`, `status` (0/1, 2 falla), `calendar`               |
| `POST /v1/device/tlx/tlx_data`                                      | SN, rango ≤ 7 días, `timezone_id`       | Historial de MIN, paginado                                                                                          |
| `/v1/device/inverter/last_new_data`, `/v1/device/tlx/tlx_last_data` | SN                                      | Último dato de un equipo                                                                                            |
| `/v1/device/inverter/alarm`, `/v1/device/tlx/alarm_data`            | SN, fecha                               | Alarmas del equipo                                                                                                  |

Tipos de equipo (`type`): 1 inversor, 2 almacenamiento, 3 otro, 4 MAX, 5 SPH, 6 SPA, 7 MIN, 8 PCS, 9 HPS, 10 PBD. Existen funciones equivalentes para SPH (mix), MAX y SPA.

**No se usan:** las funciones de control (`setting_write`, VPP y similares). PV-IoT solo lee datos.

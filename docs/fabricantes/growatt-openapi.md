# Growatt — OpenAPI (revisión de la información oficial)

**Fuentes:**

1. Respuesta del **soporte de Growatt México** a la empresa (PDF "Info_GROWATT", entregado por el equipo el 2026-11-05).
2. La documentación oficial que ese correo indica, en ShowDoc: `https://www.showdoc.com.cn/262556420217021/1494053950115877`. **Leída el 2026-11-05** con un navegador (ShowDoc rechaza las descargas automáticas). Se revisaron las 18 páginas clave; el resumen está en §4.
3. Segunda respuesta del **soporte de Growatt México** (correo de Ingrid, entregado por el equipo el 2026-11-08), sobre el alcance del límite, las consultas por lotes y el historial. Resumen en §1.1.
4. Tercera respuesta del **soporte de Growatt México** (Ingrid, entregada por el equipo el 2026-11-11). Resumen en §1.2.
5. Como contexto, no como fuente: la librería comunitaria GrowattServer (`indykoning/PyPi_GrowattServer`, `docs/openapiv1.md`). No es de Growatt y no se programa con ella (`CLAUDE.md`).

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

### 1.1 Aclaraciones del soporte (2026-11-08)

- **El límite es por función (endpoint), no por equipo.** Cada función tiene su propia frecuencia, y algunas además un tope diario. Las funciones que reciben `plant_id` gastan el límite **en cada llamada, sin importar la planta**: no se puede pedir la planta A y luego la B dentro de los mismos 5 minutos con la misma función.
- Ejemplos que da el soporte: `/v1/plant/data`, una cada 5 min; `/v1/plant/energy`, `/v1/plant/list` y `/v1/plant/modify`, una cada 5 min y **10 al día**.
- **Varias plantas a la vez:** `/v1/plant/list` trae todas las plantas de la cuenta (`plant_id`, `name`, `peak_power`, `current_power`, `total_energy`, país, fecha de alta), hasta 100 por página. `current_power` está en **kW** (confirmado por el soporte en §1.2; la documentación de ShowDoc dice W).
- **Historial:** `/v1/plant/energy` va planta por planta, con un rango de **7 días como máximo** por consulta (`start_date`, `end_date`, `time_unit` day/month/year, hasta 100 registros por página).
- **Resolución del historial:** el soporte no la tiene documentada y ofreció preguntarle a su equipo técnico.

### 1.2 Tercera respuesta del soporte (2026-11-11)

- **El límite se cuenta por token** (por cuenta de instalador) y se gasta en cada llamada a la función. Cada empresa tiene su propio límite.
- **Unidades:** `current_power` en `/v1/plant/list` y en `/v1/plant/data` (igual que `peak_power_actual`) está en **kW**; las energías, en **kWh**. El soporte pide tomar esto como válido para las conversiones, aunque ShowDoc diga W.
- **Quedan con el equipo técnico de Growatt** (prometieron responder por el mismo medio):
  1. si `invs_data` y `tlxs_data` con hasta 100 números de serie cuentan como una sola llamada;
  2. la zona horaria de `time` y `calendar`, y las unidades de `pac` y `eacToday`;
  3. cada cuánto se registra el histórico y cuántos días atrás se puede consultar;
  4. el servidor de las cuentas de México (`openapi` o `openapi-us`); depende de dónde esté alojada la cuenta.

## 2. Cómo encaja con PV-IoT

- **Credenciales por empresa, como GoodWe.** El token es de la cuenta de instalador y ve las plantas de sus clientes. Va en **Configuración → Integraciones** (`company_integrations`), cifrado. Según la documentación, el token no caduca mientras el usuario no lo revoque.
- **La lectura tiene que ser por lotes.** Como el límite es por función y no por planta (§1.1), consultar planta por planta no escala: con una función de "una cada 5 minutos" solo se leen 3 plantas cada 15 minutos. Las funciones de datos en tiempo real aceptan **hasta 100 inversores del mismo tipo por petición** (`invs_data` para tipo 1, `tlxs_data` para tipo 7 MIN, y equivalentes para SPH, MAX y SPA). Con una petición por empresa y por tipo de equipo cada 15 minutos se leen hasta 100 inversores de cada tipo; con las tres ventanas de 5 minutos de cada cuarto de hora, hasta 300.
- **Las funciones por planta quedan para tareas ocasionales**, repartidas en el tiempo: `/v1/device/list` (descubrir los equipos de cada planta, una vez al vincularla) y `/v1/plant/power` (rellenar huecos). Con una llamada cada 5 minutos son 12 plantas por hora. `/v1/plant/energy` (10 al día para toda la cuenta) no sirve para la validación diaria de todas las plantas.
- **`/v1/plant/list` no sirve para la lectura de cada 15 minutos** (10 al día). Puede servir una vez al día para el inventario o para vincular plantas.
- **Qué se guarda cada 15 minutos:** la potencia instantánea (`pac`) y, donde exista, la energía del día (`eacToday`). La energía del intervalo se obtiene de la diferencia del contador, igual que con otras marcas (`normalizeReadings`).
- **Huecos y recuperación:** `/v1/plant/power` entrega la serie del día cada 5 minutos en W, pero es una planta por llamada y una llamada cada 5 minutos para toda la cuenta. Se usa solo para huecos, con una cola que respete el límite.
- **Identificación de la planta:** por el número de serie del inversor (`device_sn`) y su tipo. El tipo decide a qué función por lotes va cada equipo. Se obtienen de `/v1/device/list` una sola vez al vincular la planta y se guardan; la plataforma ya registra el número de serie del inversor.
- **Requisito en campo:** cada equipo debe estar ligado a una planta en ShinePhone con su datalogger. Sin eso no aparece en la API.

## 3. Pendientes (ver `specs/PREGUNTAS.md` #220, #221, #225 y #226)

1. ~~Leer la documentación de ShowDoc.~~ Hecho (§4).
2. ~~Alcance del límite.~~ Por función, no por equipo ni por planta (§1.1).
3. **Preguntas al equipo técnico de Growatt** (enviadas; el soporte respondió dos y canalizó las demás, §1.2):
   1. ¿`invs_data` y `tlxs_data` con 100 números de serie cuentan como **una sola llamada** para el límite de 5 minutos?
   2. ~~¿El límite se cuenta por token?~~ Sí, por cuenta de instalador.
   3. ¿Cada cuánto se registran los datos de los inversores (5 o 15 minutos) y qué tan atrás se puede consultar?
   4. ¿En qué zona horaria vienen `time` y `calendar`? ¿En qué unidad vienen `pac` y `eacToday` de los inversores MIN?
   5. ~~`current_power` de `/v1/plant/list`: ¿kW o W?~~ kW.
   6. ¿Las cuentas de México van en `openapi.growatt.com` o en `openapi-us.growatt.com`?
4. "Probar conexión" **no debe usar** `/v1/plant/list` ni `/v1/plant/energy` (10 al día). Usar una sola llamada a `/v1/device/list` de una planta.
5. Obtener el token en OSS con la cuenta de instalador, más al menos una planta reportando, para grabar respuestas reales como ejemplos de prueba.

## 4. Funciones relevantes (documentación oficial)

Todas llevan el encabezado `token`. La respuesta tiene la forma `{ data, error_code, error_msg }`. Un `error_code` de `-1` indica usar el dominio nuevo (`server.growatt.com` → `openapi.growatt.com`; `server-us` → `openapi-us`).

### Plantas

| Función                                       | Parámetros                                                         | Datos útiles                                                                                                   | Límite                  |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET /v1/plant/list`                          | `page`, `perpage` (≤ 100)                                          | `plant_id`, `peak_power` (kWp), `current_power` (kW, según el soporte), `total_energy` (kWh), latitud/longitud | 1 cada 5 min, 10 al día |
| `GET /v1/plant/details`, `GET /v1/plant/data` | `plant_id`                                                         | Información básica y resumen de la planta                                                                      | `data`: 1 cada 5 min    |
| `GET /v1/plant/energy`                        | `plant_id`, `time_unit` (day/month/year), rango ≤ 7 días en diario | Energía en kWh                                                                                                 | 1 cada 5 min, 10 al día |
| `GET /v1/plant/power`                         | `plant_id`, `date`                                                 | Serie cada 5 min: `time` ("YYYY-MM-DD HH:mm") y potencia en W                                                  | 1 cada 5 min            |

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

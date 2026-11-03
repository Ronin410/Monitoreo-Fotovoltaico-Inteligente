# Victron Energy — VRM API (revisión de la documentación)

**Fuente:** documentación oficial en https://vrm-api-docs.victronenergy.com, especificación OpenAPI 3.1 en `docs/docs/openapi.yaml` y sus 45 archivos referenciados. Descargada el 2026-11-03; la entregó el equipo.

Este documento resume solo lo que dice la documentación. Lo que no dice queda en el §5 como pendiente: no se suple con supuestos (`CLAUDE.md`).

## 1. Datos generales

| Tema            | Lo que dice la documentación                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dirección base  | `https://vrmapi.victronenergy.com/v2`                                                                                                                                                                                                            |
| Formato         | REST con JSON. Las respuestas traen `success: true/false`; los errores traen `errors` y `error_code`.                                                                                                                                            |
| Autenticación   | Encabezado `x-authorization`. Para aplicaciones de terceros se usa un **token de acceso**: `x-authorization: Token <token>`. El formato `Bearer` queda **obsoleto desde el 1 de junio de 2026**.                                                 |
| Cómo se obtiene | Cada usuario crea sus tokens personales con `POST /users/{idUser}/accesstokens`. El token se muestra **una sola vez** y puede no vencer, o vencer en la fecha que se elija.                                                                      |
| Límite de uso   | Ventana móvil de 200 peticiones; cada 0.33 s sale una. En promedio, hasta **3 peticiones por segundo**. Si se excede responde **429** con el encabezado `Retry-After` (segundos de espera).                                                      |
| Soporte y uso   | La API es **pública**, pero Victron **no da soporte** a quien la integre, salvo acuerdos especiales con OEM grandes. El soporte es la sección _Modifications_ de Victron Community. La documentación no menciona restricciones de uso comercial. |

## 2. Funciones que usaría la plataforma

| Para qué                            | Función                                                             | Notas de la documentación                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saber quién es el usuario del token | `GET /users/me`                                                     | Devuelve id, nombre, correo y país.                                                                                                                                                                                                                                                                                                                                                                                           |
| Listar instalaciones (plantas)      | `GET /users/{idUser}/installations` (`extended=1` agrega más datos) | Cada una trae `idSite`, `name`, `identifier`, `pvMax`, `timezone` y, con `extended`, `last_timestamp` (último dato recibido, UNIX), `alarm`, `num_alarms` y `current_alarms`. Un usuario normal ve las suyas; un distribuidor (_dealer_), las de sus clientes vinculados.                                                                                                                                                     |
| Serie de producción                 | `GET /installations/{idSite}/stats`                                 | Parámetros: `start` y `end` (timestamps), `type` (`solar_yield`, `live_feed`, `kwh`, `venus`, `custom`…), `interval` (`15mins`, `hours`, `days`…) y `attributeCodes[]`. Cada serie es una lista de `[timestamp, promedio, mínimo, máximo]`, con mínimo y máximo solo si existen. **Máximo por consulta: 31 días con `15mins`.** `type=solar_yield` es "la producción solar por destino: total y FV a consumo, batería y red". |
| Totales del día, semana, mes y año  | `GET /installations/{idSite}/overallstats`                          | Mismos `type`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Equipos conectados                  | `GET /installations/{idSite}/system-overview`                       | Nombre, producto, firmware, última conexión.                                                                                                                                                                                                                                                                                                                                                                                  |
| Últimos valores registrados         | `GET /installations/{idSite}/diagnostics`                           | Paginado (`count`, `page`); trae `code`, `description` y `formatWithUnit` de cada atributo.                                                                                                                                                                                                                                                                                                                                   |
| Historial de fallas                 | `GET /installations/{idSite}/alarm-log`                             | `start` y `end` en **timestamps UNIX en segundos**, paginado. Ejemplos de códigos: `agl` red perdida, `iE` error del inversor, `meHV` / `meLV` alto / bajo voltaje.                                                                                                                                                                                                                                                           |
| Catálogo de atributos               | `GET /data-attributes`                                              | Códigos, descripción y unidad (`formatWithUnit`) de cada atributo.                                                                                                                                                                                                                                                                                                                                                            |

## 3. Cómo encaja con PV-IoT

- **Credenciales de la planta:** `access_token` (el token de la cuenta VRM del cliente o del distribuidor) e `id_site` (la instalación en VRM). Caben en el formulario actual, que acepta campos libres y los guarda cifrados. "Probar conexión" puede usar `GET /users/me` y confirmar que el `id_site` aparece en sus instalaciones.
- **Ingesta cada 15 min:** `stats` con `interval=15mins` y la ventana desde la última lectura (máximo 31 días por consulta), dentro del límite de 3 peticiones por segundo para todas las plantas Victron.
- **Alertas:** el historial de fallas (`alarm-log`) puede alimentar la regla de "inversor con falla" más adelante.
- **Una diferencia de origen:** Victron se usa mucho en sistemas con batería y fuera de la red. `pvMax` y la serie solar describen la producción FV; consumo y batería no los usa hoy la plataforma.

## 4. Lo que sí se puede programar ya

- El cliente HTTP: encabezado `Token`, validación con zod de la forma general (`success`, `records`, `totals`, errores) y manejo de 429 con `Retry-After`.
- "Probar conexión" con `/users/me` e `/installations`.
- Partir una ventana larga en tramos de 31 días.

## 5. Lo que la documentación NO dice (pendiente; ver `specs/PREGUNTAS.md` #212)

1. **Qué códigos trae `type=solar_yield`** (o cuál pedir con `custom`) para la producción FV, y si cada punto con `15mins` es **energía del intervalo (kWh) o potencia (W/kW)**. La plataforma necesita potencia en kW y la energía del día.
2. **La unidad del timestamp** en las series de `stats` (segundos o milisegundos) y si los parámetros `start` y `end` de `stats` van en segundos. Solo `alarm-log` lo especifica.
3. **Temperatura del inversor:** no aparece un atributo documentado para pedirla.
4. **Uso comercial por un tercero:** la documentación no lo prohíbe ni lo autoriza explícitamente. Conviene confirmarlo por escrito con el representante de Victron.

Los puntos 1 y 2 se resuelven con **una cuenta de prueba**: una consulta real a `stats` y a `/data-attributes` muestra los códigos y las unidades. Esa respuesta se graba como ejemplo para las pruebas automáticas.

## 6. Estado de la implementación (2026-11-03)

- **Hecho:**
  - el cliente de la VRM API (`packages/adapters/src/inverters/victron.ts`): token, manejo de 429 con `Retry-After` y errores sin el token;
  - las credenciales por planta (`access_token` e `id_site`), validadas al guardarlas;
  - **Probar conexión**: `GET /users/me` y que la instalación aparezca en `GET /users/{idUser}/installations`.
  - Se comprobó contra la API real que un token inválido responde `401 invalid_token`, como dice la documentación.
- **Hecho después (§7):** la lectura de la serie (`fetchReadings`), confirmada con respuestas reales.

### Diagnóstico con una cuenta real

1. En su cuenta de VRM, cree un token de acceso; conviene ponerle vencimiento. Anote el número de la instalación (`idSite`).
2. En la Shell de `pv-api` (o en una computadora con el repositorio), corra:
   ```sh
   pnpm victron:probe --site <idSite>
   ```
   Pide el token por la entrada estándar: no queda en el historial y no se guarda.
3. El comando hace solo consultas de lectura documentadas: usuario, instalación, `stats` de `solar_yield`, `live_feed` y `kwh` cada 15 min, `overallstats`, `diagnostics` y `data-attributes`. En `stats` no manda `start` ni `end` (usa el último día por omisión), para no suponer la unidad de las fechas.
4. Imprime qué series trae cada tipo y guarda las respuestas en `victron-probe-<idSite>-<fecha>.json`, sin el token ni datos personales de la instalación.
5. Con ese archivo se confirman los códigos y las unidades, se termina `fetchReadings` y las respuestas se graban como ejemplos de prueba. Después, borre el token en VRM.

## 7. Lo que se confirmó con respuestas reales (2026-11-03)

Victron no documenta una cuenta de prueba. Para observar el formato real se usó una vez el acceso demo público de VRM (`POST /v2/auth/loginAsDemo`, que conoce la comunidad), **solo para diagnóstico**. Ese acceso no aparece en la especificación y usa el formato Bearer, que es obsoleto. El producto no lo usa: trabaja con el token de acceso del cliente. Las consultas de datos fueron las documentadas.

| Pregunta del §5              | Respuesta observada                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Código de la producción FV   | `type=live_feed` trae `total_solar_yield`. `type=solar_yield` lo reparte en `Pb` (a batería), `Pg` (a red) y `Pc` (a consumo). En cada intervalo, `total_solar_yield` es exactamente `Pb + Pg + Pc`. |
| ¿Energía o potencia?         | **Energía del intervalo en kWh**: la suma de los puntos es igual al total del día (`totals`). La potencia media es kWh × 4.                                                                          |
| Unidad de las fechas         | Respuesta en **milisegundos**. `start` y `end` se mandan en **segundos** (en milisegundos no devuelve nada).                                                                                         |
| ¿Inicio o fin del intervalo? | **Inicio**: el primer punto cae exactamente en `start`, y los siguientes cada 900 s.                                                                                                                 |
| Intervalos sin producción    | No vienen en la serie (la noche no aparece).                                                                                                                                                         |
| Permisos del usuario demo    | No puede leer `diagnostics` ni `data-attributes` (`forbidden`), así que la temperatura del inversor sigue sin confirmarse.                                                                           |

La respuesta real de 6 horas está grabada como ejemplo de prueba en `packages/adapters/src/inverters/fixtures/victron-live-feed.json`; solo contiene números. La implementación pide desde el cuarto de hora y descarta el intervalo en curso. Se probó de punta a punta contra la API real: 24 horas quedaron en intervalos alineados a cada 15 minutos.

**Falta confirmar con una instalación propia en México:**

- que la hora de los intervalos corresponda a la producción real (las instalaciones demo son de otra zona horaria y sus datos parecen de demostración);
- la temperatura del inversor.

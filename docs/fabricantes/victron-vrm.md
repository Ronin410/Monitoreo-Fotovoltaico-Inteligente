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

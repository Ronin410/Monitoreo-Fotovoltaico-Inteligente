# 14 — Datos adicionales de los fabricantes (roadmap, fuera de alcance de la v1)

Catálogo de lo que ofrecen las APIs de Victron y GoodWe además de la producción, para medir otras cosas en el futuro. **No se programa nada de esto todavía.** Cada punto, al tomarse, necesita su propia tarea en `11-plan-de-tareas.md`, con pruebas, antes de empezar.

**Fuentes:** la documentación oficial revisada el 2026-11-03: `docs/fabricantes/victron-vrm.md` y `docs/fabricantes/goodwe-openapi.md`. Los nombres de campos y funciones vienen de ahí. Los de GoodWe se confirman con una cuenta real antes de usarlos (ver la sección de pendientes de ese documento).

## 1. Lo que se usa hoy (v1)

| Marca   | Prueba de conexión                                       | Datos                                                                                                   |
| ------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Victron | `GET /users/me`, `GET /users/{idUser}/installations`      | `GET /installations/{idSite}/stats` (`live_feed`, `total_solar_yield` cada 15 min)                       |
| GoodWe  | Token (*client credentials*), `POST base-info/plants`    | Pendiente de cuenta: `POST realtime/plants/history` (`pvPower` cada minuto)                             |

La plataforma solo necesita la energía de cada 15 min. Todas las estadísticas (PR, suciedad, alertas, reportes) se calculan igual para cualquier marca (`05-motor-de-rendimiento.md`).

## 2. Datos que existen en ambas marcas (estandarizables)

Se pueden llevar a un formato común, como la producción, y mostrarse igual sin importar la marca.

| #   | Qué mide                                   | Victron                                                                                                | GoodWe                                                                                                             | Uso propuesto                                                                                                                                                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Historial de fallas del inversor**       | `GET /installations/{idSite}/alarm-log`: tipo, descripción, equipo e instancia; ventana `start`/`end` en segundos UNIX | `POST alarm/inverters`: `warningCode`, `warningName`, `status`, `happenTime` y `recoveryTime` (ms); hasta 30 días  | Alerta "falla del inversor" con su causa. Disponibilidad (% del tiempo sin falla). Tiempo promedio de reparación, cruzado con los tiempos de tickets (#204)                                             |
| D2  | **A dónde va la energía**                  | `stats` `solar_yield` (`Pb` a batería, `Pg` a red, `Pc` a consumo); `consumption`; `grid_history_to/from` | Medidor: `totalPurchaseQ`, `totalSellQ`, `importActivePower`, `exportActivePower`, `loadPower`; `statistics` con esos indicadores | Autoconsumo y ahorro real contra el recibo de CFE, en lugar de estimarlos. Reporte mensual más creíble                                                                                                |
| D3  | **Batería**                                | `live_feed`: `bs` (carga %) y `bv` (voltaje)                                                           | `batterySoc`, `batterySoh`, `batteryTemperature`, `batteryCharge` y `batteryDischarge`, por batería                  | Salud de la batería en el tiempo. Detectar producción limitada con la batería llena, para no generar alertas falsas de rendimiento bajo (ver §4)                                                      |
| D4  | **Totales oficiales del día, mes y año**   | `GET /installations/{idSite}/overallstats`                                                             | `POST statistics/plants` (`pvGeneration`, kWh, lado DC)                                                            | **Validación diaria automática**: comparar nuestro total contra el del fabricante y avisar si difieren más de un margen. GoodWe mide del lado DC: se espera que su total sea un poco mayor              |
| D5  | **Equipos de la planta**                   | `GET /installations/{idSite}/system-overview`: equipo, producto, firmware, última conexión            | `POST base-info/plant/devices` y `base-info/device/info`                                                            | Descubrir inversores, baterías y medidores sin capturarlos a mano. Avisar de firmware desactualizado o de un equipo desconectado                                                                     |
| D6  | **Estado inmediato**                       | Instalaciones con `extended=1`: `alarm`, `current_alarms`, `last_timestamp`                             | `plantStatus` y `deviceStatus` (−1 sin conexión, 0 en espera, 1 generando, 2 falla)                                 | Detectar una planta sin conexión o en falla en minutos, sin esperar las 4 horas de la regla actual                                                                                                    |

## 3. Datos que solo tiene una marca

Se mostrarían como extras ("cuando la marca lo permite"), sin entrar en las estadísticas comunes.

| #   | Marca   | Qué mide                                                                                       | Uso propuesto                                                                                                                                                   |
| --- | ------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | GoodWe  | **Corriente por cadena** (`stringCurrent1`–`19`) y voltaje y corriente por entrada MPPT (`dcVoltage`/`dcCurrent` 1–8) | Diagnóstico por cadena: identificar la cadena con un panel dañado, un conector quemado o una sombra nueva                                                       |
| E2  | GoodWe  | **Voltaje, corriente y frecuencia de la red por fase** (`acVoltage1`–`3`…)                      | Demostrar que una baja de producción se debe al voltaje alto de la red y no a la instalación                                                                    |
| E3  | GoodWe  | **Temperatura interna del inversor** (`innerTemperature`; con historial solo en inversores con batería) | Inversor que se calienta y reduce su producción                                                                                                                |
| E4  | GoodWe  | **Control remoto** (`remote/parameter-tasks` y lecturas de parámetros)                          | **No recomendado.** Implica responsabilidad sobre equipos de terceros y el permiso `openapi:plant:remote-control`. Requiere una decisión del PO, revisión legal y su propio spec de seguridad |
| E5  | Victron | **Pronóstico** de producción y consumo (`stats` `type=forecast`)                               | Comparar contra nuestra estimación por clima; planear el día                                                                                                    |
| E6  | Victron | **Generador** (`generator`, `generator-runtime`)                                               | Horas y energía del generador en sistemas aislados de la red                                                                                                    |
| E7  | Victron | **Optimización de batería** (`dynamic-ess`) y reportes CSV/XLSX (servicio `vrm-reports-api`)     | Mostrar la estrategia de la batería; exportaciones del fabricante                                                                                               |

## 4. Prioridad propuesta

1. **D4, validación diaria contra el total del fabricante.** Da confianza en los números, y sirve en el piloto para detectar cualquier error de conversión.
2. **D3, producción limitada en plantas con batería o con límite de inyección.** Evita alertas falsas de suciedad o de caída brusca en sistemas que reducen su producción a propósito. Mientras no exista, conviene marcar esas plantas a mano y revisar sus alertas con criterio.
3. **D1, historial de fallas.** Es lo que más esperan las instaladoras: saber por qué se detuvo el inversor.
4. **D2, a dónde va la energía.** Ahorro real y autoconsumo; refuerza el plan Pro (5.3 del plan de lanzamiento).
5. **E1, diagnóstico por cadena de GoodWe**, como extra de esa marca.

## 5. Reglas al implementar cualquiera de estos puntos

- Solo con la documentación oficial y confirmado con respuestas reales grabadas como ejemplos de prueba (`CLAUDE.md`).
- Cada dato nuevo se convierte a un formato común en el adaptador. El motor y las pantallas no saben de qué marca es la planta, salvo los extras de §3.
- **Costo en consultas.** Victron limita a unas 3 por segundo y va planta por planta; GoodWe no publica su límite, pero acepta hasta 100 plantas por consulta. Antes de agregar una función que se consulta seguido, medir cuántas consultas suma con la prueba de carga (F10-T4).
- La IA sigue sin recibir datos de contacto ni credenciales (`07-asistente-ia.md`). Los datos técnicos nuevos le llegan solo por herramientas definidas.

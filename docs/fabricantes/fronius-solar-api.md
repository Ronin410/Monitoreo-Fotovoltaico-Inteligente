# Fronius — Solar API v1 (revisión del archivo entregado)

**Fuente:** `docs/fabricantes/solarapi.json`, agregado por el equipo el 2026-11-05. Es una especificación OpenAPI 3.0 con título `SolarAPIv1`, versión 1.0.1. **El archivo no indica de dónde viene.** Antes de programar con él hay que confirmar que es la documentación oficial de Fronius (`CLAUDE.md`: solo documentación oficial).

## 1. Qué es

Es la **API local** del datalogger del inversor Fronius (Datamanager o la tarjeta del Symo GEN24). Se consulta dentro de la red del cliente, en la dirección del inversor, por ejemplo `http://192.168.1.50/solar_api/v1/...`.

- El archivo **no tiene servidores** (`servers`) ni **autenticación** (`security`): las peticiones van sin llave, directo al equipo.
- **No se puede consultar desde la nube.** La plataforma no llega a la red local del cliente sin un equipo en sitio.

Funciones que trae (todas `GET`, solo lectura):

| Función                                          | Datos                                                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetInverterRealtimeData.cgi` (`Datacollection`) | `CommonInverterData`: `PAC`, `DAY_ENERGY`, `YEAR_ENERGY`, `TOTAL_ENERGY`, corrientes y voltajes, `DeviceStatus`. También `3PInverterData` y `CumulationInverterData` |
| `GetPowerFlowRealtimeData.fcgi`                  | Flujo de la planta: `P_PV`, `P_Grid`, `P_Load`, `P_Akku`, `E_Day`, `E_Total`, autoconsumo                                                                            |
| `GetMeterRealtimeData.cgi`                       | Medidor                                                                                                                                                              |
| `GetStorageRealtimeData.cgi`                     | Batería                                                                                                                                                              |
| `GetOhmpilotRealtimeData.cgi`                    | Ohmpilot (calentador)                                                                                                                                                |
| `GetActiveDeviceInfo.cgi`, `GetInverterInfo.cgi` | Equipos conectados                                                                                                                                                   |

Cada magnitud viene como `{ Unit, Value }`, con la unidad en la respuesta. Son datos del momento: no hay historial por intervalos.

## 2. Cómo encaja con PV-IoT

No encaja directamente: PV-IoT lee los datos desde la nube, cada 15 minutos, sin instalar nada en sitio (así lo dice el sitio público). Hay dos caminos:

1. **API en la nube de Fronius (Solar.web).** Fronius ofrece una API de Solar.web para instaladores. Es el camino que encaja con las demás marcas (credenciales por empresa). **Hace falta su documentación oficial.**
2. **Equipo en sitio** (un pequeño gateway en la red del cliente que lea esta API local y envíe los datos a PV-IoT). Implica hardware, instalación y mantenimiento en cada planta. No está en el alcance actual.

Recomendación: conseguir la documentación de la API de Solar.web. Esta especificación local queda como referencia de los nombres de los campos.

## 3. Pendientes (ver `specs/PREGUNTAS.md` #222)

1. Confirmar el origen del archivo (¿es de Fronius?).
2. Conseguir la documentación oficial de la API de Solar.web y cómo se obtiene el acceso.

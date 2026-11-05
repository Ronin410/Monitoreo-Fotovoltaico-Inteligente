# Growatt — OpenAPI (revisión de la información oficial)

**Fuentes:**

1. Respuesta del **soporte de Growatt México** a la empresa (PDF "Info_GROWATT", entregado por el equipo el 2026-11-05). Es la fuente oficial que tenemos hoy.
2. La documentación de referencia que ese correo indica, en ShowDoc: `https://www.showdoc.com.cn/262556420217021/1494053950115877`. **No se ha podido leer:** el dominio no está permitido en la red de la sesión. Falta descargarla o permitir el dominio.
3. Como contexto, no como fuente: la librería comunitaria GrowattServer (`indykoning/PyPi_GrowattServer`, `docs/openapiv1.md`). No es de Growatt, pero remite a la misma documentación de ShowDoc. No se programa con ella (`CLAUDE.md`).

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

- **Credenciales por empresa, como GoodWe.** El token es de la cuenta de instalador y ve las plantas de sus clientes. Encaja en **Configuración → Integraciones** (`company_integrations`), sin llaves por planta.
- **El límite de tasa es el punto crítico.** Si de verdad es "una petición cada 5 minutos" por cuenta, no se puede consultar planta por planta cada 15 minutos: con 20 plantas tomaría 100 minutos cada ronda. Hay que confirmar con la documentación de ShowDoc o con Growatt:
  1. si el límite es por cuenta, por función o por planta o equipo;
  2. si existe una función que entregue la **potencia o la energía de varias plantas en una sola consulta**;
  3. qué resolución tiene el historial (cada 5 o 15 minutos) y cuántos días por consulta.

  Según cómo sea, la ingesta de Growatt sería **por lotes**: una consulta trae todas las plantas de la empresa.

- **Requisito en campo:** cada equipo debe estar ligado a una planta en ShinePhone con su datalogger. Sin eso no aparece en la API.

## 3. Pendientes (ver `specs/PREGUNTAS.md` #220)

1. Leer la documentación de ShowDoc: funciones, parámetros, unidades, zona horaria, resolución y límites.
2. Confirmar con Growatt el alcance del límite de "una cada cinco minutos" y si hay consulta por lotes.
3. Obtener el token en OSS con la cuenta de instalador de la empresa, más al menos una planta reportando, para grabar respuestas reales como ejemplos de prueba.

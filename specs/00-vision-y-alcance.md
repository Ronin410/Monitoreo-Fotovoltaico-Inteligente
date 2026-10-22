# 00 — Visión y alcance

## Problema
Las empresas instaladoras de sistemas solares (ejemplo: instaladoras en Culiacán, Sinaloa) administran decenas o cientos de plantas de clientes con inversores de distintas marcas. Cada marca tiene su propia nube y app, así que nadie ve la flota completa. Las fallas y la suciedad se detectan tarde, normalmente cuando el cliente se queja de su recibo CFE.

En Culiacán el calor extremo baja la eficiencia de los paneles. Un monitoreo ingenuo confunde "hace calor" con "la planta está fallando" y genera falsas alarmas.

## Producto
**PV-IoT** es una plataforma SaaS en la nube, **multiempresa**: muchas instaladoras usan la misma plataforma y cada una ve solo sus datos.

Cada instaladora puede:
1. Registrar a sus clientes y sus plantas solares.
2. Ver en un solo tablero la producción y el estado de todas sus plantas, sin importar la marca del inversor.
3. Recibir alertas confiables de falla, desconexión y suciedad, ya corregidas por temperatura y clima.
4. Gestionar tickets de mantenimiento para sus técnicos.
5. Preguntarle a un asistente de IA sobre su flota en lenguaje natural.
6. Enviar a sus clientes un reporte mensual en PDF con su marca.

## Usuarios
| Rol | Quién es | Qué hace |
|-----|----------|----------|
| `superadmin` | Dueño de la plataforma (nosotros) | Da de alta empresas, ve uso y salud del sistema |
| `company_admin` | Dueño o gerente de la instaladora | Configura la empresa, usuarios, umbrales y marca; ve todo lo de su empresa |
| `operator` | Personal de oficina u operaciones | Gestiona clientes, plantas, alertas, tickets y reportes; usa el asistente IA |
| `technician` | Técnico de campo | Ve y actualiza los tickets asignados desde el celular |

El cliente final (dueño de la casa o negocio con paneles) **no inicia sesión en v1**: recibe reportes por correo.

## Alcance v1 (lo que se construye ahora)

### Base
- Multiempresa con aislamiento estricto de datos.
- Autenticación, roles e invitación de usuarios.
- CRUD de clientes y plantas, con credenciales de inversor cifradas.
- Ingesta de telemetría mediante adaptadores. En v1 se implementa el **simulador**; los adaptadores reales de marcas se agregan cuando haya documentación oficial y credenciales de prueba.
- Ingesta de clima (irradiancia en el plano del panel, temperatura, nubosidad y lluvia).
- Motor de rendimiento: PR, PR corregido por temperatura, línea base y métricas diarias.
- Tickets de mantenimiento y notificaciones por correo.
- Tablero de flota, detalle de planta y mapa.

### IA v1 (las tres funciones acordadas)
1. **Asistente analítico (chat):** preguntas en lenguaje natural sobre toda la flota de la empresa: rankings, zonas, riesgos, comparaciones. Responde con texto, tablas y gráficas. Ver `07-asistente-ia.md`.
2. **Alertas inteligentes:** comparación con plantas vecinas, predicción de días para lavado y explicación generada por IA en cada alerta. Ver `06-alertas-inteligentes.md` y `07-asistente-ia.md`.
3. **Reporte mensual narrado:** PDF de marca blanca con un resumen en lenguaje simple generado por IA. Ver `08-reportes.md`.

### Demo
- Empresa demo con aproximadamente 25 plantas simuladas en colonias reales de Culiacán y 90 días de historia, con escenarios de suciedad, falla de string, desconexión y días nublados. Debe permitir mostrar el producto completo sin acceso a inversores reales.

## Fuera de alcance v1
- Portal o app para el cliente final.
- WhatsApp (bot o notificaciones).
- Lectura de recibos CFE por foto.
- Inspección de paneles por foto o dron.
- Cotizador para prospectos.
- Costo-beneficio del lavado y rutas de cuadrillas.
- Pronóstico de generación a varios días.
- Facturación o cobro de suscripciones dentro de la plataforma (se cobra por fuera en v1).
- Subdominios por empresa.

Todo esto está descrito en `13-roadmap-v2.md`.

## Métricas de éxito de la v1
- Demo completa funcionando con datos simulados.
- Cero accesos entre empresas en las pruebas de aislamiento.
- El simulador inyecta fallas conocidas y el motor las detecta: ≥ 90 % de las fallas de suciedad y de string, y < 10 % de alertas falsas en días nublados.
- El asistente responde correctamente las preguntas del set de evaluación de `12-pruebas-y-calidad.md`.

## Glosario
- **Planta:** un sistema solar instalado de un cliente (puede tener uno o más inversores; en v1 se modela un inversor por planta).
- **kWp:** potencia pico instalada.
- **POA:** irradiancia en el plano del arreglo (*plane of array*), es decir, sobre la superficie inclinada del panel.
- **PR (Performance Ratio):** energía real entre energía teórica en condiciones STC.
- **PR corregido (PR_temp):** energía real entre energía esperada ya ajustada por temperatura.
- **Línea base:** PR_temp típico de la planta en días válidos recientes.
- **Soiling:** pérdida por suciedad o polvo sobre los paneles.
- **Día válido:** día con datos e irradiación suficientes para evaluar el rendimiento (ver `05`).

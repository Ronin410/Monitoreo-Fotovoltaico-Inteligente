# Specs PV-IoT — Índice

Plataforma SaaS B2B multiempresa para que **empresas instaladoras** de sistemas solares monitoreen las plantas de sus clientes, detecten fallas y suciedad automáticamente y usen IA para analizar su flota.

## Orden de lectura

| # | Archivo | Contenido |
|---|---------|-----------|
| 00 | `00-vision-y-alcance.md` | Qué se construye, para quién, qué entra en v1 y qué queda para v2 |
| 01 | `01-arquitectura.md` | Stack, estructura del monorepo, despliegue en Render, decisiones |
| 02 | `02-multi-tenant-y-seguridad.md` | Empresas, usuarios, roles, aislamiento de datos, cifrado |
| 03 | `03-modelo-de-datos.md` | Esquema completo de base de datos |
| 04 | `04-ingesta-y-adaptadores.md` | Inversores, clima, simulador de telemetría y jobs |
| 05 | `05-motor-de-rendimiento.md` | Fórmulas: PR, corrección por temperatura, línea base y métricas diarias |
| 06 | `06-alertas-inteligentes.md` | Reglas de alerta, comparación con vecinas, predicción de lavado, tickets |
| 07 | `07-asistente-ia.md` | Chat analítico con herramientas y explicación IA de alertas |
| 08 | `08-reportes.md` | Reporte mensual PDF con marca blanca y narrativa IA |
| 09 | `09-frontend.md` | Pantallas y flujos de la interfaz |
| 10 | `10-api.md` | Endpoints REST |
| 11 | `11-plan-de-tareas.md` | Fases y tareas ordenadas con criterios de aceptación |
| 12 | `12-pruebas-y-calidad.md` | Estrategia de pruebas y checklist de seguridad |
| 13 | `13-roadmap-v2.md` | Funciones de IA para ofrecer después (fuera de alcance v1) |

## Cómo usar estos specs con el agente
1. Sube esta carpeta y `CLAUDE.md` a la raíz del repositorio.
2. Pide al agente una tarea a la vez: *"Implementa la tarea F1-T2 de specs/11-plan-de-tareas.md"*.
3. Al terminar cada fase, el rol Tester/Seguridad corre el checklist de `12-pruebas-y-calidad.md`.
4. Las dudas abiertas se registran en `specs/PREGUNTAS.md` (lo crea el agente cuando haga falta).

## Convenciones
- Idioma de la interfaz: español (México). Código e identificadores: inglés.
- Zona horaria por defecto: `America/Mazatlan` (Culiacán). Se guarda en UTC y se muestra en la zona de la empresa o planta.
- Moneda: MXN. Unidades: kW, kWh, kWp, W/m², kWh/m², °C.

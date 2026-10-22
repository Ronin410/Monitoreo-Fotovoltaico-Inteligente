# CLAUDE.md — Instrucciones para el agente de desarrollo

Este repositorio construye **PV-IoT**, una plataforma SaaS **multiempresa (multi-tenant)** de monitoreo fotovoltaico para empresas instaladoras de sistemas solares.

## Fuente de verdad
Toda la definición del producto vive en `specs/`. Antes de cualquier tarea:
1. Lee `specs/README.md` (índice y orden de lectura).
2. Lee el spec del módulo que vas a tocar.
3. Toma la siguiente tarea pendiente de `specs/11-plan-de-tareas.md`, en orden.

Si el código y un spec se contradicen, **el spec manda**. Si un spec está incompleto o es ambiguo, no inventes: deja una nota en `specs/PREGUNTAS.md` y elige la opción más conservadora.

## Reglas no negociables
- **Aislamiento entre empresas:** toda tabla de negocio lleva `company_id`, y toda consulta se filtra por el `company_id` de la sesión. Nunca se toma de un parámetro enviado por el cliente ni de la salida de un modelo de IA. Ver `specs/02-multi-tenant-y-seguridad.md`.
- **Credenciales de inversores:** siempre cifradas y nunca devueltas por la API.
- **Fórmulas:** se implementan como funciones puras en `packages/core`, con las pruebas de `specs/05-motor-de-rendimiento.md`.
- **IA:** la IA nunca ejecuta SQL libre. Solo llama a las herramientas definidas en `specs/07-asistente-ia.md`.
- **No inventes APIs de fabricantes.** Los adaptadores reales se implementan solo con documentación oficial proporcionada por el equipo.
- TypeScript estricto, validación con `zod` en cada borde (HTTP, jobs, respuestas de IA).
- Cada tarea termina con sus pruebas pasando y sus criterios de aceptación cumplidos.

## Roles (personajes)
- **PO/Arquitecto:** mantiene `specs/`, define alcance y decide ante dudas.
- **Desarrollador:** implementa tareas de `11-plan-de-tareas.md`.
- **Tester/Seguridad:** valida con `specs/12-pruebas-y-calidad.md`, especialmente el aislamiento entre empresas.

## Comandos (a definir en la Fase 0)
- `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm db:migrate`, `pnpm db:seed:demo`

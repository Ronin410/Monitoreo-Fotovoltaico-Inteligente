# Revisión de la Fase 8 — IA: asistente analítico

Rol: Tester/Seguridad (`12` §6). Fecha: 2026-10-23. Rama `ccr-258aca7b-7dh0rc` al cierre de F8-T4 (sin la corrida con el modelo real).

**Dictamen: aprobada con una condición pendiente.** Todo lo que se puede verificar sin el modelo real pasa. Falta el criterio de F8-T4: correr `pnpm eval:assistant` con Claude y obtener ≥ 90 % de respuestas correctas y 100 % en aislamiento. En este entorno no hay `ANTHROPIC_API_KEY`. Hasta esa corrida, la fase no debe presentarse como lista para el hito demo.

## 1. Pruebas ejecutadas

Contra PostgreSQL real: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm coverage:core`. Todas pasan.

| Archivo | Qué cubre |
|---------|-----------|
| `packages/ai/src/tools/context.test.ts` | Periodos de las herramientas (presets, enero, 400 días, fechas inválidas) y que ninguna herramienta reciba `company_id` |
| `packages/ai/src/chat/agent.test.ts` | Ciclo agente: herramientas y respuesta, errores de herramienta al modelo, máximo 3 gráficas, límite de 6 rondas, negativa del modelo, enlaces a plantas |
| `packages/ai/src/ai.test.ts` | Proveedor de Anthropic: caché, salida estructurada, sin `temperature`, respaldo del servidor ante negativas, reintentos |
| `apps/worker/test/seed-demo.int.test.ts` | Las 11 herramientas contra la semilla: cifras contra la base, < 1 s cada una, sin datos de contacto, aislamiento; evaluador del asistente |
| `apps/api/test/ai-chat.int.test.ts` | `POST /ai/chat` por SSE, guardado, historial, conversaciones privadas, permisos, 2,000 caracteres, 30 por hora, presupuesto, error genérico |
| `apps/web/src/components/assistant/assistant-view.test.tsx`, `lib/assistant.test.ts` | Streaming en la pantalla, enlaces a plantas, sin enlaces externos, errores, presupuesto agotado, lectura de SSE |

Prueba en navegador real (Chromium) con un servidor local que imita la API de Messages: pregunta desde la barra del tablero, estado de la herramienta mientras responde, respuesta en streaming a través del proxy de Next, tabla markdown, gráfica de barras, enlaces a plantas, pregunta fuera de tema, cajón de conversaciones a 360 px en modo oscuro, sin errores.

## 2. Aislamiento entre empresas (`12` §2), puntos de esta fase

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| Cada herramienta con un `plant_id` de B en la sesión de A responde "no encontrada" | ✅ | `seed-demo.int.test.ts` (detalle y serie) y `ai-chat.int.test.ts` (el modelo recibe `Planta no encontrada`) |
| Las listas de las herramientas no traen datos de B | ✅ | `search_plants`, `rank_plants`, `get_plants_at_risk` y `list_alerts` sin ids de B |
| Una conversación de un usuario no es visible para otro, ni de la misma empresa | ✅ | `ai-chat.int.test.ts`: 404 al ver, continuar o borrar la de otro |
| `companyId` nunca es parámetro de una herramienta | ✅ | Esquemas sin `company`; las herramientas corren con `withTenant` de la sesión |

## 3. Checklist de seguridad (`12` §3), puntos de esta fase

| Punto | Estado | Nota |
|-------|--------|------|
| Inyección de prompt en el nombre de una planta | ⚠️ Parcial | El nombre llega como dato, el prompt de sistema lo indica y la pantalla lo escapa (no se vuelve formato ni enlace externo). Que el modelo real no cambie su comportamiento solo se comprueba con la corrida real. |
| No revela el prompt ni datos de contacto | ✅ / ⚠️ | Las herramientas nunca devuelven teléfonos, correos ni domicilios (prueba en todas). El caso 11 de la evaluación lo mide con el modelo real. |
| Al 100 % del presupuesto el chat se bloquea y las explicaciones usan plantilla | ✅ | `ai-chat.int.test.ts` y `notifications.int.test.ts` |

## 4. Hallazgos

- **H1 (pendiente, bloquea el hito demo):** correr `LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=… pnpm eval:assistant` sobre una base con `pnpm db:seed:demo` y anexar aquí la tabla. Si algún caso falla, ajustar el prompt (`packages/ai/src/prompts/chat.ts`) o las descripciones de las herramientas y repetir.
- **H2:** el set tiene los 15 casos de `12` §5; el spec pide ampliarlo a 30. Se sugiere agregar los que salgan de las preguntas reales del piloto.
- **H3 (observación):** en una corrida, la prueba de navegador vio un error de hidratación de React (#418) al escribir en el login mientras la página se hidrataba. No se reprodujo en 4 intentos ni sin interacción; se registra para vigilarlo.

# Revisión de la Fase 5 — Alertas, tickets y notificaciones

Rol: Tester/Seguridad (`12` §6). Fecha: 2026-10-23. Commit revisado: rama `ccr-258aca7b-7dh0rc` al cierre de F5-T4.

**Dictamen: aprobada con observaciones.** Ninguna observación bloquea la Fase 6. O1 y O2 requieren decisión del PO.

## 1. Pruebas ejecutadas

Contra PostgreSQL 16 real: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm coverage:core`. **41 archivos y 437 pruebas, todas pasan.** Cobertura de líneas de `packages/core`: **99.6 %** (mínimo 90 %).

| Archivo | Pruebas | Qué cubre |
|---------|--------:|-----------|
| `packages/core/src/alerts/alerts.test.ts` | 31 | Evento de zona, `sudden_drop`, `soiling`, `cleaning_due_soon`, `offline` y evidencia, con series sintéticas |
| `packages/core/src/notifications/templates.test.ts` | 7 | Plantillas: asunto, datos, enlaces, escape de HTML, color y logo seguros |
| `apps/worker/test/alerts.int.test.ts` | 9 | Job `alerts.evaluate` y regla offline contra la base; pipeline real con el simulador |
| `apps/worker/test/notifications.int.test.ts` | 7 | Correos de alerta, envío y reintento, resumen diario |
| `apps/api/test/tickets.int.test.ts` | 14 | API de alertas, tickets y eventos; técnico; aislamiento; correo de ticket asignado |
| `apps/worker/test/seed-demo.int.test.ts` | 9 | Semilla con alertas y ticket; `eval:alerts` (cumple, y falla si faltan detecciones) |

### Criterios de aceptación de F5-T1

| Caso | Prueba |
|------|--------|
| Un día nublado no dispara | `sudden_drop` › "un día nublado (no válido) no dispara…" |
| Un evento de zona suprime | `sudden_drop` › "un evento de zona suprime la alerta" y `soiling` › "un evento de zona no cuenta para la racha"; contra la base en `alerts.int.test.ts` |
| Falla de 1 de 3 strings (33 %) dispara la advertencia | Serie sintética en `core`, y el simulador con `string_failure` de 33 % en `alerts.int.test.ts` |
| Lavado que no recupera mantiene la alerta | `soiling` › "lavado que no recupera…" (marca la evidencia y pide nueva explicación una sola vez) |

### `pnpm eval:alerts` (criterio de aceptación de la fase)

Semilla de 90 días en una base nueva (135 s), con `WEATHER_PROVIDER=synthetic`:

| Escenario | Inyectados | Detectados | Recall | Retraso | Meta |
|-----------|-----------:|-----------:|-------:|---------|------|
| Suciedad (cruzó el 12 % en la historia) | 1 | 1 | 100 % | 2 días | ≤ 4 días |
| Falla de string | 2 | 2 | 100 % | 1 día cada una | ≤ 2 días |
| Offline | 1 | 1 | 100 % | 0.5 h | ≤ 1 h |
| Plantas normales con alertas falsas | 0 de 22 | | 0 % | | < 10 % |

**Resultado: cumple las metas de `00` y `12` §4.** Ver O3 sobre el tamaño de la muestra.

### Pruebas de mutación (hechas a mano)

| Pieza | Mutaciones | Resultado |
|-------|-----------|-----------|
| Reglas (`core/alerts`) | 15: sin filtro de zona; umbrales crítico y de advertencia; sin vecinas; sin chequeo de fecha; racha sin límite de 7 días; sin lluvia; pendiente ignorada; reexplicación repetida; `cleaning_due_soon` con caída o con confianza baja; resolución con 1 día; día del lavado incluido; zona sin mínimo, con inválidos y `>` en vez de `>=` | Todas detectadas. La última sobrevivió en la primera pasada y se agregó la prueba del límite exacto. |
| Job `alerts.evaluate` | 5: sin error de integración; sin recalcular estado; sin evento de zona; `ai_status` de info; resolución sin `auto` | Todas detectadas |
| Tickets | 4: el técnico ve todos; el técnico cambia cualquier campo; sin evento al resolver; ticket cerrado editable | Todas detectadas |
| `eval:alerts` | Se borran las alertas de caída brusca | El reporte falla (recall 0 %) |

## 2. Aislamiento entre empresas (`12` §2), puntos de esta fase

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| Cada endpoint nuevo con `:id` responde 404 con un recurso de otra empresa | ✅ | `tickets.int.test.ts` › aislamiento: alertas (ver, reconocer, descartar, crear ticket), tickets (ver, editar), eventos (listar, crear) |
| Las listas de A no contienen registros de B | ✅ | `/alerts` y `/tickets` vacías para A con datos solo en B |
| `company_id` en body o query no tiene efecto | ✅ | Ticket creado con `company_id` de B queda en A; filtros por query ignorados |
| Los jobs procesan cada empresa en su contexto | ✅ | `alerts.evaluate` y `notifications.*` corren con `withTenant`; el evento de zona no agrupa plantas de otra empresa (`alerts.int.test.ts`) |
| La comparación con vecinas no incluye otra empresa | ✅ | Fase 4 y evento de zona de esta fase |
| Un técnico solo ve los tickets asignados a él y las plantas de esos tickets | ✅ | 404 en tickets ajenos; los filtros se combinan con su restricción; sin acceso a `/plants` ni a `/alerts` (403); el ticket trae la planta, la dirección y el cliente |

Correos: el contenido dinámico se escapa en HTML, el logo solo se usa si es `http(s)` y el color solo si es `#RRGGBB` (`templates.test.ts`). Los errores del proveedor de correo se guardan sin secretos.

## 3. Hallazgos y observaciones

- **O1 — Falla de string frente a suciedad (#103, #107, #109).** Se aplicó la opción conservadora: con una caída brusca activa no se abren `soiling` ni `cleaning_due_soon`. Antes, en la semilla, cada falla de string abría también "posible suciedad". El PO debe confirmar; queda pendiente si los días con caída se excluyen de la tendencia.
- **O2 — Alerta descartada que vuelve (#124).** Si la condición sigue, se abre una nueva al día siguiente. Falta decidir si se quiere un periodo de silencio.
- **O3 — Muestra pequeña.** `eval:alerts` mide 4 escenarios inyectados (1 de suciedad que cruza el umbral dentro de la historia, 2 fallas, 1 offline) y 22 plantas normales. Cumple las metas, pero un recall de 100 % con 1 a 2 casos no es estadísticamente sólido. Para la Fase 10 conviene una semilla de evaluación más grande, con varias semillas aleatorias.
- **O4 — Medición de offline.** La semilla corre la regla offline una sola vez al final. Por eso el retraso se mide reproduciendo la regla cada 5 minutos sobre la última lectura real y sumando la espera a la siguiente ejecución horaria (minuto 20). El recall sí se mide con la alerta real.
- **O5 — Pendientes de otras fases.** `ai.explain_alert` (F7-T2), regenerar explicación (F7-T2), barrido de notificaciones que no se encolaron (Fase 10) y rutas del frontend para los enlaces de correo (F6).

## 4. Preguntas abiertas de esta fase

#103 (confirmar), #104–#130; las que piden decisión del PO son #103, #124 y #128.

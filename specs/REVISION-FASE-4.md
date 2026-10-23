# Revisión de la Fase 4 — Motor de rendimiento

Rol: Tester/Seguridad (`12` §6). Fecha: 2026-10-23. Commit revisado: rama `ccr-258aca7b-7dh0rc` al cierre de F4-T3.

**Dictamen: aprobada con observaciones.** Las observaciones (§4) no bloquean la Fase 5, pero O1 debe quedar resuelta dentro de ella.

## 1. Pruebas ejecutadas

Contra PostgreSQL 16 real, local y en GitHub Actions: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm coverage:core`. **36 archivos y 365 pruebas, todas pasan.** Cobertura de líneas de `packages/core`: **99.7 %** (mínimo 90 %).

| Archivo | Pruebas | Qué cubre |
|---------|--------:|-----------|
| `packages/core/src/performance/performance.test.ts` | 32 | Fórmulas de `05` §1–8; casos A, B y C de §10; límites exactos de día válido; tolerancia ±0.0001 |
| `packages/core/src/time.test.ts` y otros de `core` | 94 | Geometría solar, simulador, normalización de lecturas, fechas locales |
| `apps/worker/test/metrics.int.test.ts` | 10 | Job `metrics.daily`: cálculo, idempotencia, lluvia, suciedad, vecinas, estados, orquestador |
| `apps/worker/test/seed-demo.int.test.ts` | 5 | Semilla: datos creados, contraseñas, pipeline real, escenarios visibles, no vuelve a sembrar |

### Pruebas de mutación (hechas a mano)

Se debilitó el código a propósito y se confirmó que alguna prueba falla. Cuatro mutaciones del job sobrevivieron en la primera pasada. Se agregaron pruebas y ahora todas fallan como deben.

| Mutación | Antes | Ahora |
|----------|-------|-------|
| Línea base con P70 en vez de P80 | falla | falla |
| `F_temp` mínimo 0.4 en vez de 0.5 | falla | falla |
| Día válido con `<=` en vez de `<` (irradiación y completitud) | **sobrevivía** | falla (prueba de límite exacto) |
| `daysToCleaning` sin tolerancia de punto flotante (F4-T1) | falla | falla |
| Desviación calculada también en días no válidos | **sobrevivía** | falla |
| La tendencia de suciedad incluye el día del reinicio | **sobrevivía** | falla |
| La línea base no excluye los días con `sudden_drop` activo | **sobrevivía** | falla |
| Se calculan plantas pausadas | **sobrevivía** | falla |
| Se ignora la fecha de puesta en marcha | falla | falla |
| Mínimo de vecinas ignorado | falla | falla |
| El evento `rain_cleaning` se crea aunque ya exista | falla | falla |

### Prueba de punta a punta de la semilla

Se corrió `pnpm db:seed:demo` en una base nueva con los usuarios de conexión reales (`pv_app_login`, `pv_service_login`) y `WEATHER_PROVIDER=synthetic`:

- Tardó **93 s** (el límite es de 10 min).
- Quedaron 30 plantas con 90 días de métricas.
- Con la api compilada (`node dist/index.js`), el login del `company_admin` sembrado funciona.

Cada escenario se ve en `plant_daily_metrics`:

| Escenario | Qué se ve el último día |
|-----------|-------------------------|
| Suciedad (4 etapas) | Desviación de 3 %, 7 %, 10.7 % y 14 %; la de 10.7 % predice lavado en 2 días (confianza media), la de 7 % en 11 días |
| Falla de string reciente | La desviación sube de golpe de 0 % a 33 % hace 3 días |
| Falla de string antigua | Desviación de 33 % sostenida |
| Offline | `status = offline`, `invalid_reason = offline` |
| Sombra por la tarde | Desviación de alrededor de 6 % desde que empezó |
| Instaladas hace 9 y 6 días | `baseline_source = neighbors` |
| 15 normales | Desviación entre −1 % y 1 %, `status = ok` |

## 2. Aislamiento entre empresas

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| El job corre dentro de `withTenant` con el `company_id` del payload, no de otra fuente | ✅ | `metrics.ts` (`computeCompanyDay`), RLS de la Fase 1 |
| Vecinas solo de la misma empresa (índice y línea base provisional) | ✅ | `metrics.int.test.ts`: empresa A con 2 plantas junto a las 3 de B no obtiene índice; B solo cuenta las suyas |
| La semilla crea los datos de negocio con `pv_app` y `withTenant`; empresas y usuarios con `pv_service` | ✅ | `apps/worker/src/seed/demo.ts` |
| Contraseñas de demo fuera del repositorio y de la base (solo el hash) | ✅ | `seed-demo.int.test.ts` |

## 3. Criterios de aceptación

| Tarea | Criterio | Estado |
|-------|----------|--------|
| F4-T1 | Casos A, B y C de `05` §10 con tolerancia ±0.0001; cobertura ≥ 90 % | ✅ |
| F4-T2 | Orquestación por empresa, recálculo por rango, `rain_cleaning` automático | ✅ |
| F4-T3 | Menos de 10 minutos; cada escenario visible en `plant_daily_metrics` | ✅ (93 s) |

## 4. Hallazgos y observaciones

- **O1 — Falla de string interpretada como suciedad (resolver en F5).** La regresión de `05` §7 no distingue una caída brusca de un ensuciamiento gradual. En la demo, las dos plantas con falla de string tienen `days_to_cleaning = 0`. Mientras no existan alertas `sudden_drop` (F5-T2), la línea base tampoco excluye esos días. En F5 hay que verificar que `cleaning_due_soon` no se dispare con una `sudden_drop` abierta, y decidir si la tendencia debe reiniciarse en la caída. Queda como pregunta #103.
- **O2 — Alertas y tickets en la semilla.** Están pendientes hasta F5-T2 y F5-T3 (pregunta #98, con TODO en el código).
- **O3 — Colonias sin validar.** Los códigos postales y las coordenadas de la semilla no se pudieron validar contra SEPOMEX (pregunta #99). Lo debe validar el PO.
- **O4 — Open-Meteo sin probar contra la API real.** `api.open-meteo.com` está bloqueado por la red del entorno (heredado de la Fase 3). La semilla y las pruebas usan el clima sintético.
- **O5 — Rendimiento.** `metrics.daily_company` carga en memoria 120 días de métricas de toda la empresa. Con 25 plantas tarda menos de 1 s por día. Para empresas de cientos de plantas conviene medirlo en la Fase 10.

## 5. Preguntas abiertas que afectan a esta fase

#91–#97 (job de métricas), #98–#103 (semilla y O1). No hay bloqueantes nuevas.

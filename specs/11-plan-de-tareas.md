# 11 — Plan de tareas

Instrucción para el agente: implementa **una tarea a la vez, en orden**. Cada tarea indica los specs que debes leer y sus criterios de aceptación (CA). Una tarea está terminada cuando: compila, `pnpm lint` y `pnpm test` pasan, los CA se cumplen y se marcó `[x]` aquí con la fecha.

Leyenda de rol de validación: 🧪 = el rol Tester/Seguridad debe revisar al cerrar la fase.

---

## Fase 0 — Cimientos
- [x] **F0-T1 Monorepo.** _(2026-10-22)_ pnpm workspaces con la estructura de `01`; TypeScript estricto; ESLint y Prettier; Vitest; scripts `dev`, `build`, `test`, `lint`, `typecheck`.
  - CA: `pnpm install && pnpm build && pnpm test` funciona en limpio.
- [x] **F0-T2 Configuración.** _(2026-10-22)_ `packages/config` con carga de variables de entorno validada con zod (lista de `01`); `.env.example` completo.
  - CA: arrancar sin una variable obligatoria falla con un mensaje claro.
- [x] **F0-T3 CI.** _(2026-10-22)_ GitHub Actions: install, lint, typecheck y tests con un servicio PostgreSQL.
- [ ] **F0-T4 Render.** `render.yaml` con `pv-web`, `pv-api`, `pv-worker` y `pv-db`; migraciones en pre-deploy; `GET /health`.
  - Estado (2026-10-22): `render.yaml` listo y `GET /health` probado en local. **Pendiente:** crear el Blueprint en Render, capturar las variables `sync: false` y verificar el despliegue en staging.
  - CA: despliegue en staging con las tres apps respondiendo.

## Fase 1 — Datos, multiempresa y autenticación 🧪 (revisión: `REVISION-FASE-1.md`)
- [x] **F1-T1 Esquema.** _(2026-10-22)_ Prisma con todas las tablas de `03`; migración SQL adicional con índices especiales (BRIN, únicos parciales).
- [x] **F1-T2 RLS y `withTenant`.** _(2026-10-22)_ Políticas RLS en todas las tablas 🔒, rol de aplicación sin `BYPASSRLS`, helper `withTenant(companyId, fn)` y repositorios con tenant obligatorio (ver `02`).
  - CA: una prueba de integración demuestra que, con `app.company_id` de la empresa A, una consulta directa a datos de B devuelve 0 filas.
- [x] **F1-T3 Auth.** _(2026-10-22)_ Login, refresh con rotación, logout, recuperación de contraseña, invitaciones, rate limit de login, argon2id.
- [x] **F1-T4 Roles.** _(2026-10-22)_ Middleware de autorización según la matriz de `02`.
- [x] **F1-T5 Superadmin y empresas.** _(2026-10-22)_ Crear empresa con invitación del primer admin; suspender empresa (bloquea login y jobs).
- [x] **F1-T6 Auditoría.** _(2026-10-22)_ `audit_log` en las acciones listadas en `02`.

## Fase 2 — Inventario
- [x] **F2-T1 Clientes.** _(2026-10-22)_ CRUD API con borrado lógico.
- [x] **F2-T2 Plantas.** _(2026-10-22)_ CRUD API con valores por defecto de la empresa; copia de lat/lon, colonia y CP desde el cliente.
- [x] **F2-T3 Credenciales.** _(2026-10-22)_ Cifrado AES-256-GCM, endpoint de solo escritura, "probar conexión".
  - CA: ninguna respuesta de la API ni ningún log contiene las credenciales (prueba automática que busca el valor en las respuestas y logs).
- [x] **F2-T4 Configuración de empresa.** _(2026-10-22)_ `GET/PATCH /company`, subir logo, `settings` validado con valores por defecto.

## Fase 3 — Ingesta y simulador
- [x] **F3-T1 Infraestructura de jobs.** _(2026-10-22)_ pg-boss en `apps/worker`, `job_runs`, reintentos, idempotencia.
- [x] **F3-T2 Clima.** _(2026-10-22)_ Interfaz `WeatherProvider`, proveedores `synthetic` y `open-meteo`, job `ingest.weather` y backfill (ver `04`).
  - CA: para una planta en Culiacán con inclinación de 20° al sur se guardan 24 horas con POA > 0 solo en horas de sol.
- [x] **F3-T3 Simulador.** _(2026-10-23)_ Adaptador `simulator` con todos los escenarios de `04` §3.
  - CA: pruebas unitarias por escenario (suciedad crece y se reinicia con lluvia o limpieza; falla de string es un escalón; offline no devuelve datos).
- [x] **F3-T4 Ingesta de telemetría.** _(2026-10-23)_ Job `ingest.telemetry` con normalización a 15 min (contador diario y potencia) y ventana de sol.
- [x] **F3-T5 Esqueletos de adaptadores reales.** _(2026-10-23)_ GoodWe, Huawei, Fronius y Enphase lanzando `NotImplementedError`, con un TODO que exija documentación oficial.

## Fase 4 — Motor de rendimiento 🧪 (revisión: `REVISION-FASE-4.md`)
- [x] **F4-T1 Fórmulas puras.** _(2026-10-23)_ `packages/core/performance` con §1–8 de `05`.
  - CA: los casos A, B y C de `05` §10 y los "otros casos" pasan.
- [x] **F4-T2 Job `metrics.daily`.** Orquestación por empresa, recálculo por rango de fechas, eventos `rain_cleaning` automáticos. _(2026-10-23)_
- [x] **F4-T3 Semilla demo.** `pnpm db:seed:demo` según `04` §4, ejecutando el pipeline real sobre 90 días. _(2026-10-23)_
  - CA: la semilla termina en menos de 10 minutos y cada escenario es visible en `plant_daily_metrics` (por ejemplo, la planta con suciedad muestra tendencia descendente y la de falla de string un salto).

## Fase 5 — Alertas, tickets y notificaciones 🧪 (revisión: `REVISION-FASE-5.md`)
- [x] **F5-T1 Reglas puras.** _(2026-10-23)_ `packages/core/alerts` con las reglas de `06` §1–2.
  - CA: pruebas con series sintéticas para cada regla, incluyendo: día nublado no dispara; evento de zona suprime; falla de 1 de 3 strings (33 %) dispara la advertencia de `sudden_drop`; lavado que no recupera mantiene la alerta.
- [x] **F5-T2 Job `alerts.evaluate`.** _(2026-10-23)_ Apertura, actualización de evidencia y resolución automática; regla de una alerta abierta por tipo.
- [x] **F5-T3 Tickets.** _(2026-10-23)_ API, creación desde alerta, vista del técnico, evento `cleaning` al resolver.
- [x] **F5-T4 Correo.** _(2026-10-23)_ `EmailProvider`, plantillas con marca, notificaciones de `06` §6 y resumen diario.
  - CA: con la semilla demo, la detección cumple las métricas de `00` (≥ 90 % de fallas inyectadas detectadas, < 10 % de falsas en días nublados), medidas con el script `pnpm eval:alerts`.

## Fase 6 — Frontend base
- [x] **F6-T1 Shell.** _(2026-10-23)_ Layout, navegación por rol, marca blanca, modo oscuro, auth en el cliente.
- [x] **F6-T2 Tablero** _(2026-10-23)_ con mapa, tarjetas, próximos lavados y mejores/peores.
- [ ] **F6-T3 Plantas y clientes** (lista, detalle, formularios, credenciales).
- [ ] **F6-T4 Detalle de planta** con gráficas de `09`.
- [ ] **F6-T5 Alertas y tickets**, incluida la vista del técnico en celular.
- [ ] **F6-T6 Configuración y superadmin.**
  - CA de la fase: todas las vistas funcionan a 360 px de ancho y en modo oscuro.

## Fase 7 — IA: explicación de alertas
- [ ] **F7-T1 `packages/ai`.** `LLMProvider` con implementación de Anthropic, registro de uso, presupuesto mensual y validador de cifras.
- [ ] **F7-T2 Explicación de alertas.** Job `ai.explain_alert`, esquema de salida, plantilla de respaldo, botón regenerar (ver `07` §3).
  - CA: con el proveedor simulado devolviendo una cifra inventada, se usa la plantilla; la UI y el correo muestran el resumen.

## Fase 8 — IA: asistente analítico 🧪
- [ ] **F8-T1 Herramientas.** Las 11 herramientas de `07` §2 con esquemas zod y pruebas contra la semilla.
- [ ] **F8-T2 Ciclo agente y SSE.** `POST /ai/chat`, límite de rondas, historial, persistencia, rate limit.
- [ ] **F8-T3 UI del chat.** Conversaciones, streaming, markdown, tablas, gráficas, enlaces a plantas, preguntas sugeridas, barra rápida en el tablero.
- [ ] **F8-T4 Evaluación.** Script `pnpm eval:assistant` con el set de preguntas de `12`.
  - CA: ≥ 90 % de respuestas correctas y 100 % en las preguntas de aislamiento.

### 🎯 Hito DEMO — al terminar la Fase 8 se puede presentar al cliente.

## Fase 9 — Reportes mensuales
- [ ] **F9-T1 Cálculo de `facts`.**
- [ ] **F9-T2 Narrativa IA** con validación y plantilla.
- [ ] **F9-T3 PDF** con `@react-pdf/renderer` y `StorageProvider`.
- [ ] **F9-T4 Job, pantalla de reportes y envío.**

## Fase 10 — Endurecimiento para producción 🧪
- [ ] **F10-T1** Checklist de seguridad completo de `12`.
- [ ] **F10-T2** Limpieza de telemetría de más de 13 meses.
- [ ] **F10-T3** Backups verificados y prueba de restauración documentada.
- [ ] **F10-T4** Pruebas de carga: 500 plantas simuladas en una empresa; `ingest.telemetry` termina en menos de 5 minutos y el tablero carga en menos de 2 s.
- [ ] **F10-T5** Aviso de privacidad y términos en la plataforma.
- [ ] **F10-T6** Primer adaptador real de inversor (marca a definir con el cliente, con documentación oficial).

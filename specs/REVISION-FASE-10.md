# Revisión de la Fase 10 — Endurecimiento para producción

Rol: Tester/Seguridad (`12` §6). Se completa por tarea; el dictamen final va al cerrar la fase.

## F10-T1 — Checklist de seguridad completo de `12` (2026-10-24)

### Pruebas nuevas

| Archivo | Qué cubre |
|---------|-----------|
| `apps/api/test/isolation.int.test.ts` | Suite única de aislamiento. Descubre las rutas leyendo `src/routes`. Exige un caso entre empresas para **cada** ruta con parámetro (24 casos, todos 404, sin filtrar ids ni textos de B en el error). Revisa **cada** lista (16), también con `company_id` de B en la query. Comprueba que los recursos de B siguen intactos tras los intentos y que `company_id` en el cuerpo no cambia la empresa. Si se agrega una ruta o una lista sin caso, la prueba falla (comprobado con una ruta de prueba). |
| `apps/api/test/auth.int.test.ts` | Revocación inmediata: bajar de rol → 403 en la siguiente petición; suspender la empresa o borrar al usuario → 401 aunque el token no haya vencido. |
| `packages/db/test/raw-sql.test.ts` | Revisión estática: fuera de `withTenant` nadie usa `set_config`, `app.company_id` ni `$executeRawUnsafe`/`$queryRawUnsafe` (cierra H4 de la Fase 1). |

### Suite de aislamiento (`12` §2)

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| Cada endpoint con `:id`: recurso de B pedido por A → 404 | ✅ | `isolation.int.test.ts` (todas las rutas; las excepciones son públicas o de superadmin y están justificadas en la prueba) |
| Las listas de A nunca contienen registros de B | ✅ | `isolation.int.test.ts` (todas las listas de empresa) |
| `company_id` en body o query no tiene efecto | ✅ | `isolation.int.test.ts`, `authorization.int.test.ts`, `tickets.int.test.ts` |
| Herramientas de IA con `plant_id` de B → "no encontrada" | ✅ | `seed-demo.int.test.ts`, `ai-chat.int.test.ts` |
| Conversación de un usuario no visible para otro | ✅ | `ai-chat.int.test.ts`; `isolation.int.test.ts` (ver y borrar) |
| Consulta directa con `app.company_id` de A sobre B → 0 filas | ✅ | `rls.int.test.ts` |
| Jobs en el contexto de su empresa | ✅ | Pruebas del worker (`alerts`, `notifications`, `reports`: un reporte de B pedido con la empresa A → `not_found`) |
| Vecinas sin plantas de otra empresa | ✅ | `metrics.int.test.ts`, `alerts.int.test.ts` |
| Técnico solo ve sus tickets y sus plantas | ✅ | `tickets.int.test.ts` |

### Checklist de seguridad (`12` §3)

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| argon2id; login con límite; errores que no revelan el correo | ✅ | `auth.int.test.ts` |
| Refresh en cookie `httpOnly` + `Secure`, rotado y revocable | ✅ | `auth.int.test.ts` (incluye reuso) |
| Credenciales cifradas, nunca en respuestas ni logs | ✅ | `credentials.int.test.ts` recorre más de 30 respuestas, los logs y la auditoría buscando los secretos |
| CORS restringido, Helmet, límite de body | ✅ | `app.test.ts` |
| Logo validado (tipo, tamaño, SVG saneado) | ✅ | `company.int.test.ts` |
| Sin secretos en el repositorio (escaneo en CI) | ✅ | Job `security` de CI con gitleaks sobre todo el historial: 48 commits, sin hallazgos tras revisar 3 falsos positivos |
| Dependencias sin vulnerabilidades críticas (`pnpm audit` en CI) | ✅ | Job `security`; corrida local: "No known vulnerabilities found" |
| Inyección de prompt en el nombre de una planta | ✅ / ⚠️ | `ai-chat.int.test.ts` (el nombre llega como dato, sin datos de otra empresa). Falta la corrida con el modelo real (H1 de la Fase 8). |
| No revela el prompt ni datos de contacto | ✅ / ⚠️ | Las herramientas no devuelven teléfonos, correos ni domicilios; los casos 11 y 12 de `eval:assistant` necesitan el modelo real |
| Presupuesto de IA al 100 % | ✅ | `ai-chat.int.test.ts`, `notifications.int.test.ts`, `reports.int.test.ts` (narrativa con plantilla) |
| Auditoría de las acciones de `02` | ✅ | `audit.int.test.ts` (catálogo) y una prueba por acción: login, usuarios, empresas, credenciales, umbrales, borrado de plantas, envío de reportes |

### Hallazgos de revisiones anteriores

| # | Estado |
|---|--------|
| F1-H2: access token válido 15 min tras desactivar o suspender | **Cerrado**: cada petición revisa usuario, empresa y rol en la base (PREGUNTAS #194) |
| F1-H4: `set_config` dentro de `withTenant` | **Cerrado**: revisión estática automática |
| F1-H6: gitleaks y `pnpm audit` fuera de CI | **Cerrado**: job `security` |
| F1-H5: límite de intentos en memoria | Abierto, aceptable con una instancia de `pv-api` (PREGUNTAS #22) |
| F1-H3 / F0-T4: staging en Render | Abierto, depende del equipo |
| F8-H1: `eval:assistant` con el modelo real | Abierto, necesita `ANTHROPIC_API_KEY` |

**F10-T1: aprobada.** Los puntos ⚠️ dependen de la corrida con el modelo real, ya registrada como pendiente.

## F10-T2 — Limpieza de telemetría de más de 13 meses (2026-10-24)

| Caso | Prueba (`apps/worker/test/retention.int.test.ts`) |
|------|------|
| Borra lecturas anteriores al mismo día de hace 13 meses (zona de la empresa); conserva desde 00:00 locales de ese día | ✅ "borra las lecturas de más de 13 meses…" |
| Incluye plantas eliminadas; no toca otra empresa; idempotente | ✅ mismo caso |
| Las métricas diarias se conservan | ✅ mismo caso |
| `metrics.recompute` no pisa métricas de días ya limpiados | ✅ "un recálculo no pisa…" (`skipped_before` en `job_runs`) |
| El orquestador encola a las empresas activas | ✅ |

La fecha de corte es una función pura en `core` (`telemetryRetentionStart`, con fin de mes y bisiestos). El panel de salud del superadmin ahora nombra también los jobs de IA, reportes y limpieza. Pregunta abierta al PO sobre la retención de clima por hora y `job_runs` (PREGUNTAS #196).

## F10-T3 — Respaldos y prueba de restauración (2026-10-24) — parcial

Herramienta: `pnpm db:verify-restore` (`packages/db/scripts/verify-restore.sh`); procedimiento en `packages/db/README.md` §Respaldos y restauración.

Corrida local sobre la base demo (`pv_iot_seed`, PostgreSQL 16.15, 50 MB):

| Verificación | Resultado |
|---|---|
| Respaldo `pg_dump` (custom) | 3.3 MB |
| Restauración en base nueva | 3 s (prueba completa: 4 s) |
| Filas por tabla | idénticas: 35 tablas, 206,244 filas (incluye las colas) |
| Migraciones | 5 de 5 (última `20261022230034_jobs`) |
| RLS forzado / políticas | 19 tablas / 26 políticas, igual que el origen |
| Permisos | `pv_app` 74, `pv_service` 115, igual que el origen |
| Colas | 13 tablas de `pgboss` a nombre de `pv_service` |
| Aislamiento en la copia, como `pv_app` | 0 filas sin empresa; 29 plantas propias y 0 ajenas con empresa |
| Protecciones del script | Se niega con un rol sujeto a RLS (`pv_service_login`) y con un destino cuyo nombre no contiene `restore` |

Hallazgo **H1 (media)**: con `FORCE ROW LEVEL SECURITY`, el respaldo lógico necesita un rol superusuario o con `BYPASSRLS` (PREGUNTAS #197). Hay que confirmarlo en Render.

**Pendiente para cerrar la tarea:** verificar en el panel de Render que los respaldos diarios estén activos y repetir la prueba en staging restaurando un respaldo de Render (depende de F0-T4). También guardar `CREDENTIALS_ENC_KEY` fuera de Render y definir el respaldo del bucket S3.

## F10-T4 — Pruebas de carga con 500 plantas (2026-10-24)

Comandos (sobre una base cuyo nombre contiene `load`, recién migrada):

```sh
pnpm --filter @pv/worker load:test        # crea la empresa "Carga 500 plantas" y mide ingest.telemetry
pnpm --filter @pv/api load:dashboard      # mide las peticiones del tablero con esa empresa
```

Resultados (PostgreSQL 16 local; corrida desde una base vacía):

| Meta | Resultado |
|---|---|
| `ingest.telemetry` de 500 plantas < 5 min | ✅ **51 s**: orquestador más 500 jobs en pg-boss con concurrencia 5; 500/500 correctos, 2,000 intervalos guardados, ~102 ms por planta |
| Tablero < 2 s (API, peticiones en paralelo como el navegador) | ✅ **306 ms** en frío; p95 de **120 ms** en caliente. Por petición (p95): `/dashboard/*` 78–100 ms, alertas abiertas 98 ms, `/me` 39 ms. Lista de plantas ordenada por PR: 83 ms |
| Tablero < 2 s (Chromium real, de la navegación a los 500 marcadores dibujados) | ✅ **≤ 0.84 s** escritorio y **≤ 0.66 s** celular (5 cargas cada uno, sin mosaicos externos) |

Supuestos y límites en PREGUNTAS #198: con un proveedor real cuenta su latencia. Se debe repetir con el adaptador de F10-T6.

Observaciones:
- **O1 (baja):** `pg` avisa *"Calling client.query() when the client is already executing a query is deprecated"*. Viene de las consultas en paralelo (`Promise.all`) dentro de una misma transacción de `withTenant`. Hoy funciona, porque pg las encola, pero `pg@9` lo quitará. Antes de actualizar `pg` a la versión 9 hay que volver secuenciales esas consultas o fijar la versión.
- **O2 (UX):** con 500 plantas los marcadores del mapa se amontonan a nivel ciudad. Agruparlos (clustering) mejoraría la lectura; se propone para el roadmap.

## F10-T5 — Aviso de privacidad y términos (2026-10-24)

| Caso | Evidencia |
|---|---|
| Páginas públicas `/privacidad` y `/terminos`, sin sesión | Build estático (`○`); revisadas en Chromium a 360 px y en modo oscuro, sin scroll horizontal |
| Enlaces en login, recuperación y restablecimiento de contraseña, invitación (con leyenda de aceptación) y barra lateral | `AuthCard` y `app-shell`; `legal-page.test.tsx` |
| El aviso coincide con el comportamiento real (IA sin datos de contacto, retención de 13 meses) | `legal-page.test.tsx` |
| Aviso en los reportes | Pie del PDF (F9-T3) |

**Pendiente (fuera del código):** revisión legal y datos de la persona moral (PREGUNTAS #199). Hasta entonces, las páginas muestran el aviso de borrador.

## Estado de la fase al 2026-10-24

| Tarea | Estado |
|---|---|
| F10-T1 Checklist de seguridad | ✅ Aprobada |
| F10-T2 Limpieza de telemetría | ✅ Aprobada |
| F10-T3 Respaldos y restauración | ⏳ Parcial: herramienta y prueba local listas; falta Render/staging (F0-T4) |
| F10-T4 Pruebas de carga | ✅ Aprobada (repetir con el adaptador real) |
| F10-T5 Aviso de privacidad y términos | ✅ En la plataforma; texto pendiente de revisión legal |
| F10-T6 Primer adaptador real | ⛔ Bloqueada: falta elegir la marca con el cliente y su documentación oficial (CLAUDE.md: no se inventan APIs de fabricantes) |

**Dictamen provisional:** el código queda listo para producción en seguridad, retención y carga. La fase no se puede cerrar hasta:
1. desplegar staging (F0-T4) y repetir allí la prueba de restauración;
2. tener la revisión legal del aviso y los términos;
3. correr `eval:assistant` con el modelo real (F8-H1);
4. tener el adaptador real (F10-T6) y repetir la prueba de carga con él.

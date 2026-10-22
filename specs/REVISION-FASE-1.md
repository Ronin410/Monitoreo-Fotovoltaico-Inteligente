# Revisión de la Fase 1 — Datos, multiempresa y autenticación

Rol: Tester/Seguridad (`12` §6). Fecha: 2026-10-22. Commit revisado: rama `ccr-258aca7b-7dh0rc` al cierre de F1-T6.

**Dictamen: aprobada con observaciones**, pendiente de que el PO ratifique y resuelva las preguntas marcadas como bloqueantes antes de desplegar el frontend (ver §4).

## 1. Pruebas ejecutadas

`pnpm test` contra PostgreSQL 16 real (local y en GitHub Actions, con una base nueva en cada corrida): **14 archivos, 156 pruebas, todas pasan.** También pasan `pnpm lint`, `pnpm typecheck` y `pnpm build`.

| Archivo | Pruebas | Qué cubre |
|---------|--------:|-----------|
| `packages/core/src/permissions.test.ts` | 46 | Matriz de `02` transcrita rol por rol |
| `apps/api/test/auth.int.test.ts` | 23 | Login, refresh, logout, recuperación, invitaciones, límites, logs sin secretos |
| `packages/db/test/rls.int.test.ts` | 21 | RLS, roles, `withTenant`, rol de plataforma |
| `apps/api/test/authorization.int.test.ts` | 15 | 403 por rol, 404 entre empresas, `company_id` en body y query ignorado |
| `apps/api/test/admin.int.test.ts` | 12 | Alta y suspensión de empresas, panel sin datos operativos |
| `packages/config/src/env.test.ts` | 10 | Variables de entorno |
| `packages/db/test/schema.int.test.ts` | 9 | Tablas, índices y restricciones |
| `apps/api/test/audit.int.test.ts` | 9 | Auditoría de acciones sensibles |
| Otros | 11 | Health, CORS, Helmet, límites de body, arranque, correo, heartbeat |

Pruebas de mutación hechas a mano: se debilitó deliberadamente el código y se confirmó que las pruebas fallan.

| Mutación | Resultado |
|----------|-----------|
| Política RLS cambiada a `USING (true)` | 7 pruebas de RLS fallan; las de `withTenant` siguen pasando (cada capa protege sola) |
| Sin revocación al reusar un refresh token | Falla la prueba de reuso |
| Límite de intentos desactivado | Fallan las 2 pruebas de límite |
| `requirePermission` deja pasar a todos | Falla la prueba de 403 por rol |

Pruebas de humo con el build real (`node dist/index.js`) y usuarios de conexión reales (`pv_app_login`, `pv_service_login`): login y `/me` funcionan. Con el usuario dueño en `DATABASE_URL`, la api se niega a arrancar ("es superusuario; tiene BYPASSRLS; es dueño de 22 tablas").

## 2. Suite de aislamiento entre empresas (`12` §2)

| Punto | Estado | Evidencia |
|-------|--------|-----------|
| Cada endpoint con `:id`: recurso de B pedido por A → 404 | ✅ para los existentes (`PATCH /company/users/:id`) | `authorization.int.test.ts` |
| Las listas de A no contienen registros de B | ✅ (`GET /company/users`) | `authorization.int.test.ts` |
| `company_id` en body o query no tiene efecto | ✅ | `authorization.int.test.ts` (body en invitaciones y usuarios; query en la lista) |
| Herramientas de IA con `plant_id` de B → "no encontrada" | ⏳ Fase 8 | — |
| Conversaciones de chat no visibles entre usuarios | ⏳ Fase 8 | — |
| Consulta directa con `app.company_id` de A sobre datos de B → 0 filas | ✅ (las 18 tablas con `company_id`) | `rls.int.test.ts` (CA de F1-T2) |
| Jobs procesan cada empresa en su contexto | ⏳ Fase 3 (`listActiveCompanies` listo) | `platform.int.test.ts` |
| Comparación con vecinas sin plantas de otra empresa | ⏳ Fase 4 | — |
| Técnico solo ve sus tickets y sus plantas | ⏳ Fase 5 | — |

Controles adicionales verificados: sin `app.company_id` el rol `pv_app` ve 0 filas; el valor no sobrevive a la transacción; `pv_app` no puede insertar, modificar, borrar ni mover filas a otra empresa; FK compuestas impiden referencias entre empresas; `pv_service` no puede leer clientes, telemetría, métricas ni alertas.

## 3. Checklist de seguridad (`12` §3), puntos aplicables

| Punto | Estado |
|-------|--------|
| argon2id; login con límite; errores que no revelan si el correo existe | ✅ (también tiempo de respuesta igualado y auditoría de intentos con correo inexistente) |
| Refresh en cookie `httpOnly` + `Secure`, rotado y revocable | ✅ (más detección de reuso) |
| Credenciales de inversor cifradas, fuera de respuestas y logs | ⏳ F2-T3 |
| CORS restringido, Helmet, límite de body | ✅ |
| Subida de logo validada | ⏳ F2-T4 |
| Sin secretos en el repositorio (escaneo en CI) | ⚠️ Escaneo manual sin hallazgos; **falta gitleaks en CI** (F10-T1) |
| Dependencias sin vulnerabilidades críticas (`pnpm audit` en CI) | ⚠️ `pnpm audit` manual: sin vulnerabilidades; **falta en CI** (F10-T1) |
| Inyección de prompt, prompt de sistema, presupuesto de IA | ⏳ Fases 7 y 8 |
| Auditoría de acciones de `02` | ✅ login, usuarios, roles, empresas; ⏳ credenciales, umbrales, borrado de plantas y reportes (el catálogo ya los incluye) |

## 4. Hallazgos

| # | Severidad | Hallazgo | Recomendación |
|---|-----------|----------|---------------|
| H1 | **Alta (bloquea el frontend en Render)** | `pv-web.onrender.com` y `pv-api.onrender.com` son sitios distintos; el navegador no enviará la cookie de refresh `SameSite=Lax` (PREGUNTAS #24) | Decidir antes de F6: dominios propios del mismo sitio o proxy `/api` desde Next.js |
| H2 | Media | Un access token sigue válido hasta 15 min tras desactivar al usuario o suspender la empresa (PREGUNTAS #23, #37) | Decidir si cada petición revisa el estado en la base |
| H3 | Media | Staging no está desplegado (F0-T4) y no se ha confirmado que el usuario dueño de Render pueda crear roles (PREGUNTAS #14) | Desplegar staging y correr las migraciones allí |
| H4 | Baja | Dentro de `withTenant`, `$queryRaw` puede volver a fijar `app.company_id` (las variantes `*Unsafe` ya no están en el tipo) | Revisión de código: prohibir `set_config` en SQL de repositorios; considerar una regla de lint |
| H5 | Baja | El límite de intentos vive en memoria del proceso; no sirve con varias instancias de `pv-api` (PREGUNTAS #22) | Aceptable con una instancia; almacén compartido si se escala |
| H6 | Baja | gitleaks y `pnpm audit` no corren en CI | Agendado en F10-T1; se puede adelantar |
| H7 | Informativa | Si la api no podía arrancar (rol inseguro), Node imprimía la traza completa además del mensaje | **Corregido** durante la revisión: se registra un solo mensaje fatal y el proceso sale con código 1 |

## 5. Conclusión

Los criterios de aceptación de F1-T1 a F1-T6 se cumplen y el aislamiento entre empresas funciona en dos capas independientes, comprobado por pruebas que fallan cuando se debilita cualquiera de ellas. Ninguna observación bloquea seguir con la Fase 2. H1 debe resolverse antes de desplegar el frontend (Fase 6) y H3 antes de considerar terminada F0-T4.

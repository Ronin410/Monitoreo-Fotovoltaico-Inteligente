# Preguntas abiertas y decisiones provisionales

Dudas encontradas al implementar. Cada una indica la opción conservadora que se eligió mientras el PO decide.

## F0-T2 — Variables de entorno

1. **`LLM_PROVIDER=mock`.** `01` solo lista `anthropic`, pero `11` (F7-T2) y `08` §5 piden un "proveedor simulado" para pruebas. Se agregó el valor `mock`, que **no se permite con `NODE_ENV=production`**. ¿De acuerdo?
2. **`SMTP_*`.** `01` dice solo `SMTP_*`. Se definieron `SMTP_HOST`, `SMTP_PORT` (obligatorias con `EMAIL_PROVIDER=smtp`), `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_SECURE` (opcionales).
3. **`EMAIL_PROVIDER` sin valor por defecto.** `01` lo escribe como `resend|smtp` sin elegir uno; se dejó obligatorio para que nadie despliegue sin configurar el correo.
4. **Variables agregadas que no están en `01`:** `NODE_ENV`, `PORT` (Render lo asigna) y `LOCAL_STORAGE_DIR` (directorio para `STORAGE_PROVIDER=local`, por defecto `./storage`).
5. **`SIMULATOR_ENABLED` por defecto `false`.** `01` indica `true` en staging/demo; fuera de ahí se asume apagado.

## F1-T1 — Esquema

6. **Columna `alerts.dismiss_reason`.** `06` §4 exige "motivo obligatorio" al descartar, pero `03` no tiene dónde guardarlo. Se agregó `dismiss_reason text null` con un CHECK que la exige cuando `status = 'dismissed'`.
7. **`users.password_hash` nullable.** Un usuario `invited` todavía no tiene contraseña.
8. **Tabla para recuperación de contraseña.** `02` pide un token de un solo uso que expira en 1 hora, pero `03` no define la tabla. Se resolverá en F1-T3; la opción conservadora es una tabla `password_reset_tokens` (user_id, token_hash, expires_at, used_at), análoga a `refresh_tokens`.
9. **Precisión de columnas `numeric`.** `03` no la indica (salvo lat/lon y kWp). Se eligió: potencia y energía `numeric(14,4)`, irradiancia `numeric(8,2)`, irradiación `numeric(8,4)`, PR e índices `numeric(8,5)`, porcentajes `numeric(5–8,2–3)`, temperaturas `numeric(6,2)`, tarifas `numeric(10,4)`.
10. **Estados de `job_runs.status`.** `03` no los enumera; se usó `running`, `succeeded`, `failed`.
11. **`companies.plan`** se dejó con valor por defecto `standard` (informativo en v1).
12. **Integridad entre empresas en la base de datos.** Además de `company_id` en cada tabla, las relaciones obligatorias hacia plantas, clientes y conversaciones usan FK compuesta `(id, company_id)`, así una fila no puede apuntar a una planta de otra empresa aunque falle la capa de aplicación. Las referencias opcionales `alerts.ticket_id`, `maintenance_tickets.alert_id` y `plant_events.ticket_id` usan FK simple (con `ON DELETE SET NULL`); RLS (F1-T2) cubre su aislamiento.
13. **CHECK de dominio agregados:** CP de 5 dígitos, rangos de inclinación (0–90) y orientación (0–360), kWp > 0, γ < 0, `simulation_profile` solo con marca `simulator`, correo en minúsculas, `company_id` null solo para superadmin, periodos `YYYY-MM` y color de marca hexadecimal.

## F1-T2 — RLS y `withTenant`

14. **Creación de roles en Render.** La migración `rls` crea los roles de grupo `pv_app` y `pv_service` (`CREATE ROLE … NOLOGIN NOBYPASSRLS`). Hay que confirmar en staging que el usuario dueño de Render Postgres tiene permiso `CREATEROLE`; si no, se crean desde el panel y la migración solo les asigna permisos.
15. **Alcance de `pv_service`.** `02` dice "solo operaciones de plataforma". Se le dio acceso completo a `companies`, `users`, `invitations`, `refresh_tokens`, `audit_log` y `job_runs`, y solo lectura de `solar_plants` y `ai_usage_monthly` (conteos del panel de superadmin). No puede leer clientes, telemetría, métricas ni alertas. La variable de conexión (`SERVICE_DATABASE_URL`, no listada en `01`) se agregará cuando la use el login (F1-T3).
16. **`FORCE ROW LEVEL SECURITY`.** Se forzó RLS también para el dueño de las tablas: si `DATABASE_URL` se configura por error con el usuario dueño, la app ve 0 filas en lugar de todas.
17. **Tablas de plataforma con `company_id` nullable** (`users`, `audit_log`, `job_runs`) también llevan RLS: `pv_app` solo ve las filas de su empresa; las de plataforma (`company_id` NULL) solo `pv_service`.
18. **Permisos más estrictos que el spec:** `pv_app` no puede crear ni borrar empresas, no puede borrar usuarios (se desactivan) y `audit_log` es de solo anexado.
19. **Migraciones con `MIGRATION_DATABASE_URL`** (no listada en `01`): la usa solo el CLI de Prisma; api y worker usan `DATABASE_URL` con el usuario de `pv_app`.

## F1-T3 — Autenticación

20. **Política de contraseña.** El spec no la define; se exige entre 10 y 128 caracteres (el máximo evita abusar del costo de argon2id).
21. **Mensajes de error de login.** Contraseña incorrecta, correo inexistente, usuario desactivado y empresa suspendida responden igual (`401 INVALID_CREDENTIALS`) para no revelar si el correo existe. El costo: un usuario de una empresa suspendida no sabe por qué no entra. ¿Se prefiere un mensaje específico de "empresa suspendida" (solo con la contraseña correcta)?
22. **Límite de intentos en memoria.** 5 por minuto por IP y por correo, contando todos los intentos (no solo los fallidos). Funciona con una sola instancia de `pv-api`; con varias se necesita un almacén compartido. Se aplicó el mismo límite a `forgot-password` para evitar el envío masivo de correos.
23. **Revocación del access token.** Un JWT sigue siendo válido hasta 15 minutos después de desactivar al usuario o suspender la empresa; el refresh ya se niega de inmediato y `/me` revisa el estado en la base. ¿Basta, o cada petición debe revisar el estado del usuario (una consulta extra por petición)?
24. **Cookie `SameSite=Lax` entre dominios de Render.** `onrender.com` está en la Public Suffix List, así que `pv-web.onrender.com` y `pv-api.onrender.com` son sitios distintos y el navegador **no enviará** la cookie de refresh desde el web. Opciones para F6: dominios propios del mismo sitio (`app.ejemplo.com` y `api.ejemplo.com`) o que Next.js reenvíe `/api` a `pv-api` (mismo origen). Hay que decidirlo antes de desplegar el frontend.
25. **Reuso de refresh token.** Si se presenta un refresh token ya rotado (posible robo), se revocan todas las sesiones del usuario.
26. **Aceptar invitación inicia sesión.** `POST /auth/invitations/:token/accept` devuelve la sesión (como el login). Si el correo ya tiene cuenta en cualquier empresa, responde `409` (un usuario pertenece a una sola empresa).
27. **Endpoint para crear invitaciones.** `AuthService.createInvitation` ya existe; `POST /company/invitations` se expone en F1-T4 junto con la autorización por rol.
28. **Correo.** Se implementaron `EmailProvider`, SMTP (nodemailer) y Resend porque la recuperación y las invitaciones lo necesitan. Las plantillas son texto simple; las de marca llegan en F5-T4.
29. **Rutas del frontend en los enlaces de correo:** `/restablecer-contrasena/:token` e `/invitacion/:token` (se crean en F6-T1).

## F1-T4 — Roles

30. **Matriz como datos.** La tabla de `02` vive en `packages/core/permissions.ts` (`can(role, permiso)`), con una prueba que la transcribe fila por fila. El frontend la usará para la navegación por rol (F6-T1).
31. **Permisos del técnico limitados por recurso.** "Ver plantas … solo plantas de sus tickets" y "Actualizar tickets asignados" no se resuelven solo con el rol: el técnico no tiene `fleet:read`, y las rutas de plantas y tickets (F5-T3/F6) verificarán que el recurso esté ligado a un ticket asignado a él.
32. **403 contra 404.** Un rol sin permiso recibe `403 FORBIDDEN`; un recurso de otra empresa sigue respondiendo `404` (specs/02). El superadmin recibe `403` en todas las rutas de empresa.
33. **Gestión de usuarios incluida en F1-T4.** `11` no asigna `GET /company/users`, `POST /company/invitations` ni `PATCH /company/users/:id` a ninguna tarea; se implementaron aquí para tener rutas reales donde aplicar la autorización. Reglas conservadoras agregadas: un admin no puede cambiar su propio rol ni desactivarse, la empresa siempre conserva un `company_admin` activo, y desactivar a un usuario revoca sus sesiones.
34. **Invitaciones pendientes.** `10` no define un endpoint para listarlas ni para cancelarlas. ¿Se necesitan para la pantalla de usuarios (F6-T6)?

## F1-T5 — Superadmin y empresas

35. **Creación del primer superadmin.** Ningún spec dice cómo nace. Se agregó `pnpm admin:create-superadmin <correo> "<nombre>"` (contraseña por entrada estándar).
36. **`GET /admin/health`** depende de `job_runs` y del worker; se implementa en F3-T1.
37. **Efecto de suspender.** Bloquea el login, el refresh, `/me` y la aceptación de invitaciones, y revoca de inmediato todas las sesiones de la empresa. Los access tokens ya emitidos siguen siendo válidos hasta 15 minutos en otras rutas (ver #23). Los jobs se pausan porque el worker solo encola trabajo para `listActiveCompanies()` (se conecta en F3-T1).
38. **Uso de IA "del mes" en el panel.** Se calcula con el periodo `YYYY-MM` en la zona horaria de cada empresa; los registros de `ai_usage_monthly` (F7) deben usar la misma regla.
39. **Alta de empresa.** El slug se genera del nombre si no se indica (sin acentos ni signos) y debe ser único. Si el correo del primer admin ya tiene cuenta en cualquier empresa, el alta se rechaza (`409`) en lugar de crear una empresa sin administrador posible.

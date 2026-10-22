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

## F1-T6 — Auditoría

40. **Qué se registra del login.** El exitoso y también los fallidos (con el motivo: `invalid_password`, `user_not_active`, `company_suspended`, `unknown_email`). Los intentos con correo inexistente se guardan sin el correo y sin empresa: así ningún caso tarda distinto y no se guarda información personal de terceros. No se registran el logout ni cada refresh.
41. **Sin endpoint de consulta.** `10` no define una ruta para leer `audit_log`. ¿Se necesita una pantalla de auditoría para el `company_admin`? Las filas ya quedan limitadas por RLS a su empresa.
42. **Acciones del superadmin sobre una empresa** (alta, suspensión, cambio de plan) se guardan con el `company_id` de esa empresa, así que serán visibles para su admin si se agrega la consulta de #41.

## F2-T1 — Clientes

43. **Estructura de rutas de `10`.** Se movieron todas las rutas a `apps/api/src/routes/<módulo>/` con sus esquemas zod de entrada **y salida** en `schemas.ts`. Cada respuesta pasa por su esquema de salida, que descarta campos no declarados (barrera contra fugas, por ejemplo de credenciales en F2-T3).
44. **Documento OpenAPI (`/api/docs` en staging).** `10` lo pide pero ninguna tarea de `11` lo incluye. Los esquemas de salida ya existen; generar el documento con `zod-to-openapi` queda pendiente de asignar.
45. **Borrar un cliente con plantas vigentes** responde `409 CLIENT_HAS_PLANTS` en lugar de borrar en cascada. ¿Se prefiere que el borrado del cliente también borre (lógicamente) sus plantas?
46. **El borrado de clientes no se audita**: `02` solo lista la eliminación de plantas. ¿Se agrega?
47. **Tarifa CFE** se guarda en mayúsculas y se valida como código corto (`1F`, `DAC`, `PDBT`, `GDMTH`…), no contra una lista cerrada, porque `03` solo da ejemplos.
48. **Búsqueda `q`** busca en nombre del cliente y nombre de contacto, sin distinguir mayúsculas; acentos sí cuentan ("ferreteria" no encuentra "Ferretería"). ¿Se necesita búsqueda insensible a acentos (extensión `unaccent`)?

## F2-T2 — Plantas

49. **Rangos de `settings`.** `03` da los valores por defecto pero no los rangos válidos. Se eligieron, en `packages/core/settings.ts`: por ejemplo γ entre −1 y −0.05 %/°C, NOCT entre 30 y 70 °C, umbral de suciedad entre 1 y 50 %. F2-T4 los usará para validar el PATCH de la empresa.
50. **Ubicación copiada, no ligada.** Al crear la planta se copian lat/lon, colonia y CP del cliente si no se indican. Si después se edita la ubicación del cliente, sus plantas no cambian. ¿Se prefiere propagar el cambio?
51. **Orden de la lista.** `09` pide ordenar por PR, desviación y días para lavado, pero esas métricas llegan en la Fase 4. Por ahora `sort` acepta `name`, `created_at` y `capacity_kwp` (con `-` para descendente).
52. **Inversor simulado.** `09` dice "solo en staging o empresas demo"; no existe una marca de "empresa demo" en `03`, así que se controla con `SIMULATOR_ENABLED`. Al cambiar una planta simulada a una marca real se descarta su `simulation_profile`.
53. **Técnico y detalle de planta.** Por ahora el técnico no puede leer `/plants/:id`; el acceso a "las plantas de sus tickets" se agrega con los tickets (F5-T3).

## F2-T3 — Credenciales de inversor

54. **Contradicción en `02`: "solo el worker las descifra" contra "Probar conexión llama al adaptador".** Probar las credenciales ya guardadas exige descifrarlas, y el worker con colas no existe hasta F3-T1. Decisión provisional: el descifrado vive en un solo lugar (`CredentialCipher.decrypt`, `packages/adapters`) y en la api solo lo usa `POST /plants/:id/credentials/test`, en memoria. ¿Se mueve la prueba al worker en F3-T1 (la api encola y espera el resultado)?
55. **Credenciales ligadas a su planta.** El texto cifrado usa como dato autenticado (AAD de GCM) la empresa y la planta: copiar la fila a otra planta o empresa hace fallar el descifrado.
56. **Forma de las credenciales.** Sin documentación oficial de cada marca no hay esquema por proveedor: se acepta un objeto de hasta 20 campos simples (texto, número o booleano). Cada adaptador real validará su `credsSchema` cuando se implemente.
57. **Cambio de marca.** Al cambiar `inverter_brand` se borran las credenciales de la planta (eran de otro proveedor).
58. **Rotación de llave.** `CredentialCipher` ya descifra con versiones anteriores, pero `01` solo define la llave actual (`CREDENTIALS_ENC_KEY` + `CREDENTIALS_KEY_VERSION`). Falta definir la variable para la llave anterior y el procedimiento de re-cifrado.
59. **Prueba de conexión.** Responde siempre `200` con `ok` y un mensaje genérico (también si el adaptador no está implementado), limitada a 5 por minuto por planta, con un tiempo máximo de 15 s. Una planta sin credenciales responde `409`, salvo el simulador, que no las necesita.
60. **Adelanto de F3-T5.** La prueba de conexión necesitaba adaptadores: ya existen la interfaz `InverterAdapter` de `04`, el registro y los esqueletos de GoodWe, Huawei, Fronius y Enphase que lanzan `NotImplementedError`. F3-T5 queda para agregar los TODO que exigen documentación oficial.

## F2-T4 — Configuración de empresa

61. **Cómo se guardan los `settings`.** En la base se guardan solo los valores personalizados; al leer se completan con los valores por defecto del código. Ventajas: un valor por defecto que cambie en el futuro aplica a quien no lo personalizó, y "Restablecer" consiste en mandar la sección en `null`. El PATCH es estricto: un campo mal escrito responde `400` en lugar de ignorarse.
62. **`PATCH /company` rechaza campos que no son del admin** (`slug`, `plan`, `status`, presupuesto de IA, `company_id`) con `400` en lugar de ignorarlos, para que un error del frontend no pase desapercibido. Plan, estado y presupuesto los cambia solo el superadmin.
63. **Subida del logo.** Cuerpo binario con `Content-Type` `image/png`, `image/jpeg` o `image/svg+xml` (no multipart). El tipo se verifica por el contenido; el SVG se sanea con DOMPurify (sin scripts, eventos, `<style>`, `foreignObject`, `<use>` ni recursos externos). Algunos logos exportados usan `<use>` y podrían perder partes: en ese caso conviene subirlos en PNG.
64. **Logos públicos.** Se sirven sin autenticación en `/api/public/logos/:empresa/:archivo` (aparecen en correos, PDFs y el web), con nombre aleatorio, caché larga y una CSP que impide ejecutar nada. Reemplazar el logo borra el anterior.
65. **`StorageProvider`.** Disco local y S3 compatible (R2 o S3) implementados; el de S3 no se ha probado contra un bucket real.
66. **Versión de jsdom.** jsdom 30 exige Node ≥ 22.22.2; se usa jsdom 29 para no subir el requisito de Node.

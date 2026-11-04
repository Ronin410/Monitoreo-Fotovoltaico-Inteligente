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
24. **Cookie `SameSite=Lax` entre dominios de Render.** `onrender.com` está en la Public Suffix List, así que `pv-web.onrender.com` y `pv-api.onrender.com` son sitios distintos y el navegador **no enviará** la cookie de refresh desde el web. Opciones para F6: dominios propios del mismo sitio (`app.ejemplo.com` y `api.ejemplo.com`) o que Next.js reenvíe `/api` a `pv-api` (mismo origen). Hay que decidirlo antes de desplegar el frontend. **Decisión provisional (F6-T1), reversible:** Next.js reenvía `/api/*` a `pv-api` por la red privada de Render (`API_INTERNAL_URL`), así el navegador habla con un solo origen. Funciona con o sin dominios propios. Ver #132.
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

## F3-T1 — Infraestructura de jobs

67. **Rol de pg-boss.** Las colas usan `SERVICE_DATABASE_URL` (rol `pv_service`) y el esquema `pgboss`; ni la api ni el worker necesitan el rol dueño. Los jobs por empresa acceden a datos con `pv_app` + `withTenant`.
68. **`job_runs` registra cada intento** (no solo el último), con `stats.attempt`. Se agregó el estado `skipped` para jobs de empresas suspendidas o inexistentes; un payload inválido queda `failed` con `invalid_payload` y no se reintenta. El texto de error se guarda recortado a 500 caracteres: los jobs no deben poner secretos en sus errores (la ingesta convertirá los errores del proveedor en mensajes genéricos).
69. **Latido del worker.** `worker.heartbeat` corre cada 5 minutos por cron → cola → `job_runs`, para que el panel de salud vea el circuito completo. Son ~288 filas al día: ¿se agrega la limpieza de `job_runs` antiguos (por ejemplo, más de 30 días) a F10-T2?
70. **Idempotencia.** Un job puede declarar `singletonKey(payload)`; su cola usa la política `exclusive` de pg-boss (un solo job pendiente o activo por clave) y encolar otro igual no hace nada. Los handlers además deben ser idempotentes (upserts), porque un reintento puede repetir trabajo.
71. **Horarios por zona de cada empresa.** pg-boss programa cada cron en una sola zona horaria. Para `metrics.daily` (22:00 local de cada empresa) y `reports.monthly` se usará un orquestador horario que revisa la hora local de cada empresa (F4-T2).
72. **Pregunta #54 sigue abierta:** la prueba de conexión de credenciales sigue en la api hasta que se decida si pasa al worker.

## F3-T2 — Clima

73. **Open-Meteo no verificado contra la API real.** La red de este entorno bloquea `api.open-meteo.com`. El adaptador sigue la documentación pública (irradiancia inclinada `global_tilted_irradiance` con `tilt` y `azimuth`, azimut 0 = sur, valores de radiación y lluvia referidos a la hora anterior) y sus pruebas validan nuestra conversión con respuestas simuladas, pero hay que probarlo contra el servicio real antes de producción. ⚠️ También falta revisar sus términos de uso comercial (`01`).
74. **Proveedor sintético.** Determinista por lugar (lat/lon a 2 decimales) y día: plantas cercanas comparten nubes y lluvia. Usa hora solar local para la temperatura (mínima al amanecer, máxima a las 15:00) y transpone la irradiancia al plano con 80 % directa y 20 % difusa. Sirve para demo y pruebas, no para estimar producción real.
75. **Ingesta horaria.** `ingest.weather` (cron a los 5 minutos de cada hora UTC) encola `ingest.weather_company` por empresa activa; cada una pide las 3 últimas horas cerradas, o el día local completo a las 21:00 de su zona. Solo plantas activas, sin borrar y con ubicación.
76. **Backfill.** Se encola `weather.backfill` (90 días) al crear una planta y cuando cambian su ubicación, orientación o vuelve a estar activa. El endpoint de pronóstico de Open-Meteo cubre ~3 meses atrás; para más historia habría que usar su endpoint histórico.
77. **`suncalc` 2.x** cambió de unidades respecto a la 1.x (ahora grados y azimut desde el norte); se usan sus propios tipos.

## F3-T3 — Simulador

78. **Interpretación de los escenarios de `04` §3.**
    - Las fechas de `soiling`, `string_failure` y `shading` son **locales** (zona de la empresa); `end` de `string_failure` es inclusivo. `offline` usa fechas y horas ISO con zona.
    - La suciedad se reinicia en la hora en que la lluvia acumulada del día local alcanza `rain_reset_mm`, o en el momento de un evento `cleaning`. Se topó la pérdida en 60 %.
    - Solo se generan lecturas con sol (POA > 0), como un inversor real. Durante `offline` no hay lecturas, pero el contador diario sigue sumando (se modela como pérdida de comunicación, no apagado): al volver, la ingesta debe manejar el salto del contador (F3-T4).
    - Dentro de cada hora se usa el mismo POA del clima horario para los cuatro intervalos de 15 min.
79. **Ruido.** Normal con σ = `noise_pct` %, con semilla `hash(seed, plant_id, ts)`: la misma planta y hora dan siempre la misma lectura.

## F3-T4 — Ingesta de telemetría

80. **Relleno de huecos ≤ 1 h.** "Se reparte la diferencia" se implementó creando filas para los intervalos faltantes con su parte de la energía (potencia = energía / 0.25 h) y `status_code = 'filled'`. Esas filas cuentan como intervalos con datos para la completitud de `05` §1. ¿Deben contar, o solo sumar energía sin contar como "hora cubierta"?
81. **Primer intervalo sin anterior** (o tras un hueco > 1 h): se usa el método de potencia aunque haya contador, porque la diferencia no se puede atribuir a un intervalo.
82. **Errores del proveedor.** Cualquier falla del adaptador se convierte en `ProviderError` cuyo texto es solo el tipo de error (`provider_error: NotImplementedError`), sin el mensaje del proveedor. pg-boss reintenta 3 veces con backoff exponencial (30 s, 60 s, 120 s) y cada intento queda en `job_runs` con el `plant_id` en `stats`; la regla `offline` (F5) usará eso para distinguir "error nuestro" de "el inversor no reporta".
83. **Concurrencia.** `ingest.telemetry_plant` corre hasta 5 plantas en paralelo por worker, para todas las marcas juntas (no por proveedor). Bastará mientras solo exista el simulador; con marcas reales conviene una cola por proveedor.
84. **Sin credenciales.** Una planta de marca real sin credenciales se omite (`skipped: no_credentials`), no se marca como falla.
85. **Ventana de sol.** El orquestador corre cada 15 min y solo encola plantas cuando la hora actual está entre amanecer − 30 min y atardecer + 30 min del día local; las plantas sin lat/lon se omiten.

## F4-T1 — Fórmulas del motor de rendimiento

86. **Prioridad de `invalid_reason`.** `05` §3 no la define cuando falla más de una condición. Se usa: `no_weather` → `offline` → `low_irradiation` → `incomplete_data` (sin clima no se puede evaluar nada; sin telemetría la planta está desconectada).
87. **Percentil 80.** Interpolación lineal entre rangos (método R-7, el de Excel y NumPy).
88. **PR sin horas cubiertas.** Si no hay horas cubiertas con sol, `pr` y `pr_temp` son `null` (no 0).
89. **Confianza de la predicción.** Se calcula siempre que hay ≥ 7 puntos (describe el ajuste), aunque `days_to_cleaning` sea `null` por no haber tendencia. La regla `cleaning_due_soon` (F5) exige además días entre 1 y 7.
90. **Vecinas sin ubicación.** Si la planta evaluada no tiene lat/lon, se pasa directo al criterio de código postal.

## F4-T2 — Job `metrics.daily`

91. **Hora de cálculo.** `metrics.daily` corre cada hora (minuto 10) y encola `metrics.daily_company` para las empresas activas cuya hora local es 22:00, con la fecha local de ese día. Una tarea por empresa y fecha (`singletonKey`); `metrics.recompute` recalcula un rango (máx. 400 días) en orden, porque cada día usa la historia de los anteriores.
92. **Puntos de la tendencia de suciedad.** Se usan los días válidos **posteriores** a la fecha local del último reinicio (el día del reinicio queda fuera, porque mezcla horas sucias y limpias). Sin reinicio se toman los últimos 120 días.
93. **Desviación.** `deviation_pct` solo se calcula en días válidos. En un día no válido queda `null` y no influye en el estado.
94. **Línea base provisional.** Sin 10 días válidos propios se usa la mediana de las líneas base **propias** de las vecinas de la misma empresa (mismos criterios de radio y código postal de `05` §6). Si no hay suficientes, se usa 0.85 (`default`).
95. **Puesta en marcha.** No se calculan métricas de una planta para fechas anteriores a su `commissioning_date`, ni de plantas pausadas o eliminadas.
96. **Lluvia.** El evento `rain_cleaning` automático se crea en la hora en que la lluvia acumulada del día local alcanza `rain_reset_mm` (igual que en el simulador). Es idempotente por instante exacto.
97. **Encadenado con alertas.** Encolar `alerts.evaluate` al terminar se implementará en F5-T2, cuando exista ese job.

## F4-T3 — Semilla demo

98. **Alertas y tickets en la semilla.** `04` §4 pide alertas y tickets "ya procesados por los jobs reales", pero esos jobs son de la Fase 5. La semilla ejecuta hoy clima → telemetría → métricas. Al cerrar F5-T2 y F5-T3 se le agregará `alerts.evaluate` sobre la historia y el ticket abierto de la falla de string antigua (hay un TODO en `apps/worker/src/seed/demo.ts`).
99. **Colonias de Culiacán.** No se pudieron validar contra una fuente oficial (SEPOMEX) los códigos postales y las coordenadas. Se usan puntos aproximados al centro de cada colonia (Centro 80000, Las Quintas 80060, Tres Ríos 80020, Chapultepec 80040, Guadalupe 80220, Infonavit Humaya 80020, Villa Universidad 80010), con un desplazamiento de ±400 m, nunca domicilios reales. **El PO debe validarlos** (`apps/worker/src/seed/demo-data.ts`).
100. **Escenarios visibles.** La lluvia lava los paneles, así que a las 4 plantas con suciedad se les asignan los puntos con la lluvia más antigua: se consulta el clima de 21 puntos candidatos (3 por colonia) y la planta más sucia recibe el más seco. La suciedad empieza el día siguiente a la última lluvia, con la tasa que deja la pérdida pedida hoy (3 %, 7 %, 10.5 % y 16 %). Otras fechas: la falla de string reciente es de hace 3 días y la antigua de hace 25; la planta queda offline desde las 09:00 de hace 2 días; la sombra de la tarde empieza hace 30 días; las 2 plantas nuevas se instalaron hace 9 y 6 días.
101. **Re-ejecución.** La semilla no borra nada: si ya existen las empresas demo, termina con un mensaje. Se niega a correr con `NODE_ENV=production`. Las métricas llegan hasta ayer (día local completo). Los correos usan el dominio reservado `demo.pv-iot.example`.
102. **Hash de contraseñas compartido.** `hashPassword` y `verifyPassword` (argon2id) se movieron a `@pv/adapters` para que la semilla del worker use exactamente los mismos parámetros que la API.

## Revisión de la Fase 4

103. **Falla de string frente a tendencia de suciedad.** Una caída brusca (falla de string) entra en la regresión de `05` §7 como si fuera suciedad y da `days_to_cleaning = 0`. Propuesta conservadora para F5: con una `sudden_drop` abierta no se emite `cleaning_due_soon`, y los días con `sudden_drop` activo se excluyen también de los puntos de la tendencia (igual que de la línea base). ¿Lo confirma el PO?

## F5-T1 — Reglas puras de alertas

104. **Grupos del evento de zona.** `06` §1 dice "por código postal (o por el radio de vecinas)". Se usan los dos: cada código postal es un grupo, y también cada planta con sus vecinas a ≤ radio. Basta que un grupo cumpla (≥ `neighbor_min_count` plantas válidas y ≥ `zone_event_pct` % con desviación > umbral) para marcar a todas sus plantas. Así se suprimen más falsas alarmas. Las plantas con día no válido no forman parte del grupo.
105. **Fecha de disparo.** `sudden_drop` y `soiling` solo se abren si el último día válido sin evento de zona es la fecha evaluada (un día nublado hoy no abre alertas con días viejos). Los días inválidos o con evento de zona se saltan para buscar "el día válido anterior" y para la racha de suciedad.
106. **Advertencia de `sudden_drop`.** "2 días válidos seguidos" se toma como dos días elegibles consecutivos (saltando inválidos). `neighbor_index < 0.8` se evalúa en el último día. Si la alerta está abierta y hoy se cumple la condición crítica, la severidad sube a `critical` (nunca baja).
107. **`soiling` frente a `sudden_drop`.** Con una alerta `sudden_drop` abierta o disparándose hoy, `soiling` no se abre, aunque la pendiente sea negativa. El spec solo lo pide cuando no hay pendiente calculable, pero la propia caída inclina la regresión: en la semilla, las dos plantas con falla de string abrían también "posible suciedad". Es la opción conservadora de #103, pendiente de confirmar por el PO.
108. **Resoluciones.**
    - Solo cuentan los días válidos posteriores a la fecha de detección.
    - Para `soiling` se usa el último evento `cleaning` o `rain_cleaning` desde la detección, y los días válidos posteriores a la fecha del evento: el día del lavado mezcla horas sucias y limpias, igual que en #92.
    - `cleaning_did_not_recover` se marca una sola vez y solo esa vez pide regenerar la explicación IA.
    - `cleaning_due_soon` se resuelve también con `rain_cleaning`.
109. **`cleaning_due_soon` con caída brusca.** Por la misma razón (#103), con un `sudden_drop` abierto o disparándose no se abre `cleaning_due_soon`.
110. **`offline`.** Las horas con sol se cuentan con la elevación solar > 0 en pasos de 5 min, desde la última lectura (o, si nunca hubo, desde la puesta en marcha o el alta). Se resuelve cuando llega una lectura posterior a la detección. Con `provider_error` no se crea alerta; la alerta que ya estaba abierta no se toca.

## F5-T2 — Job `alerts.evaluate`

111. **Nombres de los jobs.** `alerts.evaluate` (por empresa y fecha) aplica las reglas diarias y lo encola `metrics.daily_company` al terminar. La regla `offline` corre cada hora (minuto 20, después de la ingesta de :15) con el orquestador `alerts.offline`, que encola `alerts.offline_company` por empresa, igual que los demás jobs.
112. **El recálculo no evalúa alertas.** `metrics.recompute` no encola `alerts.evaluate`: reabrir o resolver alertas con fechas pasadas confundiría. La semilla sí intercala métricas y alertas día por día, como pasaría cada noche.
113. **Fecha de detección y resolución.** Una alerta diaria se marca como detectada (o resuelta) a las 22:00 locales del día evaluado, o en el momento actual si es antes. Así `detected_at` refleja el día de los datos aunque la evaluación se repita.
114. **Estado del día.** Después de aplicar las alertas se recalcula `status` del día (`05` §8) con las alertas que quedaron abiertas. Si no, una alerta crítica nueva se vería en el estado hasta el día siguiente.
115. **Problema de conexión.** Para no crear la alerta `offline`, se toma el último intento de `ingest.telemetry_plant` de la planta en `job_runs`. Cuenta como problema de conexión que haya fallado con `ProviderError` o que se haya omitido por `no_credentials`. Ahora `job_runs` guarda `plant_id` en todos los intentos, también en las fallas.
116. **Evidencia.** `plant_daily_metrics` no guarda r² de la tendencia: la evidencia lleva `confidence` (y `days_to_cleaning`) en su lugar. Cada `last_14_days` incluye `zone_event`. La evidencia de `offline` es distinta: `last_reading_at`, horas de sol sin datos y el umbral.
117. **Pendiente para F5-T4 y F7-T2.** Al abrir una alerta `warning` o `critical` se debe encolar `notifications.send` y `ai.explain_alert`. Esos jobs aún no existen; quedaron TODO en `apps/worker/src/jobs/alerts.ts`. Las alertas `info` se guardan con `ai_status = skipped`.

## F5-T3 — Tickets

118. **Alcance de la API.** Además de `/tickets`, se implementaron `GET /alerts`, `GET /alerts/:id`, `POST /alerts/:id/acknowledge`, `POST /alerts/:id/dismiss`, `POST /alerts/:id/ticket` y `GET/POST /plants/:id/events`, porque crear desde una alerta y registrar limpiezas son parte del ciclo de vida. `POST /alerts/:id/regenerate-explanation` queda para F7-T2. El filtro `open=true` en alertas y tickets agrupa los estados abiertos.
119. **Ticket desde alerta.**
    - Tipo: `soiling` y `cleaning_due_soon` → `cleaning`; `sudden_drop` y `offline` → `inspection`.
    - Prioridad: `critical` → `high`, `warning` → `normal`, `info` → `low`.
    - El título y la descripción se generan en español con la desviación de la evidencia y, cuando exista, el resumen de la explicación IA.
    - Crear el ticket deja la alerta `acknowledged` y la liga (`alerts.ticket_id` y `maintenance_tickets.alert_id`).
    - Si ya hay un ticket abierto para la alerta, responde 409 `TICKET_EXISTS`.
120. **Estados del ticket.**
    - Al crearlo queda `scheduled` si trae `scheduled_for`; si no, `pending`.
    - Uno `resolved` o `cancelled` ya no se modifica (409 `TICKET_CLOSED`).
    - `resolved_at` es la hora de la API al resolver.
    - El evento `cleaning` (`source = ticket`) se crea al resolver si `cleaning_performed` es verdadero, con las notas de la resolución.
121. **Técnico.**
    - Ve y modifica solo los tickets asignados a él; los demás le responden 404, igual que un recurso de otra empresa.
    - Solo puede cambiar `status`, `resolution_notes` y `cleaning_performed`, y no puede cancelar (403).
    - El ticket incluye lo necesario para ir a campo: planta, coordenadas, dirección, cliente y teléfono. Así el técnico no necesita acceso a `/plants`.
122. **Responsable.** Debe ser un usuario activo de la empresa con rol `technician`, `operator` o `company_admin`.
123. **Eventos manuales.** Se aceptan `cleaning`, `repair`, `inverter_replaced` y `note`. `rain_cleaning` solo lo crea el sistema y `commissioning` sale de la fecha de la planta. No se aceptan fechas futuras (tolerancia de 5 min).
124. **Alerta descartada que vuelve.** Si se descarta una alerta y la condición sigue (por ejemplo, suciedad), `alerts.evaluate` abrirá una nueva al día siguiente, porque el índice único solo cubre las abiertas. ¿Se quiere un periodo de silencio después de descartar? Por ahora no hay.
125. **Semilla.** La falla de string con alerta más antigua tiene un ticket `scheduled` de inspección para mañana, asignado al primer técnico y ligado a la alerta (que queda `acknowledged`).

## F5-T4 — Correo

126. **Cómo se envía.** Quien detecta el evento guarda una fila por destinatario en `notifications` (en su misma transacción) y, al confirmar, encola `notifications.send` con su id. El envío arma el correo con la plantilla y la marca vigente de la empresa, marca `sent` o `failed` (con el error, sin secretos) y pg-boss reintenta 3 veces. Si encolar falla, la fila queda `queued`. Falta un barrido que reencole esas filas (Fase 10).
127. **Destinatarios y repeticiones.**
    - Alerta nueva `warning` o `critical`: `alert_emails` más los `company_admin` activos, sin repetir correos aunque cambien mayúsculas.
    - Un mismo evento no se notifica dos veces al mismo destinatario: `related_type` + `related_id`, y para el resumen la fecha.
    - Ticket asignado: solo el responsable, al crear o reasignar; volver a asignar a quien ya fue avisado no repite el correo.
128. **Resumen diario.**
    - Sale a las 07:00 locales a `alert_emails` más los admins y operadores activos.
    - Lleva:
      - los conteos de alertas abiertas por severidad;
      - hasta 10 alertas `warning`/`critical` que requieren atención;
      - los próximos lavados (`days_to_cleaning` ≤ 7 en las métricas de ayer);
      - las plantas con alerta `offline` abierta.
    - Si no hay nada que reportar no se envía (sería ruido). ¿El PO prefiere recibirlo siempre?
129. **Historia sin correos.** No se notifican alertas detectadas hace más de 24 h (recálculos), y la semilla de demo suprime todos sus correos (`suppressNotifications`).
130. **Plantillas.**
    - Son funciones puras en `packages/core/notifications`, en español, con texto y HTML.
    - Encabezado con el color de marca (si no es `#RRGGBB` se usa uno neutro) y el logo solo si es una URL `http(s)`.
    - Todo el texto dinámico se escapa.
    - Los enlaces usan `APP_URL` con las rutas `/alerts/:id`, `/tickets/:id` y `/`, que el frontend (F6) debe respetar.
    - El correo del técnico incluye el enlace a Google Maps con las coordenadas.

## `pnpm eval:alerts`

131. **Cómo se mide.** Los escenarios inyectados salen de `simulation_profile`. Cada uno se cuenta así:
    - **Suciedad:** cuenta si la desviación cruzó el umbral en un día válido de la historia (las de 3 % y 7 % nunca deben alertar). El retraso va desde ese día hasta la detección de `soiling`. Si cruzó hace menos de 4 días y aún no hay alerta, no se cuenta.
    - **Falla de string:** cuenta si empezó dentro de la historia y hace al menos 2 días. El retraso va del inicio a la detección de `sudden_drop`.
    - **Offline:** ver O4 de `REVISION-FASE-5.md`.
    - **Falsas:** cualquier alerta `warning` o `critical` en una planta sin escenario (incluidas las de Mazatlán y las nuevas). La planta con sombra no cuenta ni como inyectada ni como normal.
    - **Metas:** las de `12` §4. Si no se cumplen, el script termina con código 1.

## F6-T1 — Shell

132. **Proxy `/api`.**
    - Es un manejador de ruta de Next (`app/api/[...path]`) que lee `API_INTERNAL_URL` al ejecutarse.
    - Solo reenvía una lista de cabeceras permitidas. `X-Forwarded-For` pasa sin cambios: la API confía en un salto, el borde de Render agrega la IP real y así el límite de intentos de login sigue siendo por cliente.
    - Copia cada `Set-Cookie`, pasa el cuerpo como flujo (servirá para el SSE del asistente) y rechaza segmentos `.` y `..`. Si la API no responde, devuelve 502 `API_UNAVAILABLE`.
    - `API_URL` de la API debe ser igual a `APP_URL`.
    - Hay que verificarlo en staging (F0-T4).
133. **Sesión en el navegador.**
    - El access token vive solo en memoria. Al cargar la página se renueva con la cookie de refresh, que es httpOnly con `path=/api/auth`.
    - Ante un 401, el cliente renueva una sola vez (compartida entre peticiones simultáneas) y reintenta. Si la renovación falla, la sesión pasa a anónima y la app lleva al login con `?next=`, que solo acepta rutas internas.
    - Todas las respuestas se validan con zod también en el frontend.
134. **Rutas.**
    - Las secciones usan rutas en inglés (`/plants`, `/alerts/:id`, `/tickets/:id`…), como los enlaces de los correos (#130). Las de autenticación usan las rutas en español ya enviadas por correo (#29): `/login`, `/recuperar-contrasena`, `/restablecer-contrasena/:token` e `/invitacion/:token`.
    - Inicio por rol: el técnico va a `/tickets` y el superadmin a `/admin/companies`.
    - Una sección sin permiso muestra "No tienes acceso" (la API vuelve a verificar).
    - Las secciones de tareas siguientes muestran "En construcción" con la tarea del plan.
135. **Marca, tema y accesibilidad.**
    - El color de la empresa (solo `#RRGGBB`) es el acento. El texto sobre él es blanco o casi negro según su contraste (≥ 4.5:1).
    - Modo claro, oscuro o del sistema, guardado en el navegador y aplicado antes de pintar.
    - Objetivos táctiles de 44 px, enlace "Saltar al contenido" y menú de celular con `aria-expanded`.
    - Sin scroll horizontal a 360 px (verificado en el navegador).
136. **Turbopack.** `@pv/core` importa archivos `.ts` con extensión `.js` (ESM de Node) y Turbopack de Next 16 no lo resuelve. `dev` y `build` usan webpack (`--webpack`) con `extensionAlias`. Se puede volver a Turbopack cuando lo soporte.

## F6-T2 — Tablero

137. **Endpoints del tablero.**
    - `/dashboard/summary`:
      - Energía de hoy: telemetría desde las 00:00 locales.
      - Energía del mes: métricas diarias del 1 a ayer más la telemetría de hoy.
      - PR corregido de 7 días: promedio de días válidos de los 7 días anteriores a hoy.
      - Alertas abiertas (`open` y `acknowledged`) por severidad.
      - Plantas offline: alertas `offline` abiertas.
    - `/dashboard/map`: el estado actual de cada planta lo mandan sus alertas abiertas (`offline` > crítica > advertencia); si no tiene, cuenta el último día calculado de los últimos 2; sin eso, `no_data`.
    - `/dashboard/upcoming-cleanings`: `days_to_cleaning` ≤ N del último día reciente, sin plantas con caída brusca abierta (#103).
    - `/dashboard/top-bottom`: mínimo 5 días válidos; con menos de 10 plantas, ninguna aparece en las dos listas.
138. **"Requieren atención"** usa `GET /alerts?open=true` y muestra las 5 más recientes `critical`/`warning`, sin los avisos `info`. La barra "Pregúntale a tu flota" lleva a `/assistant?q=…`, que se implementa en F8-T3.
139. **Mapa.**
    - Leaflet con mosaicos de `tile.openstreetmap.org`. La política de uso de OSM no admite tráfico alto: para producción conviene un proveedor de mosaicos con cuenta o contrato (decisión del PO, Fase 10).
    - Los marcadores cambian de color y forma por estado (círculo, rombo, cuadrado, anillo), son más grandes para ≥ 30 kWp y se abren con teclado.
    - En este entorno los mosaicos están bloqueados por la red; en el navegador del usuario cargan.
140. **Marca blanca (corrección).** Las variables de color de marca se declaran con `@theme inline`. Antes, Tailwind las resolvía en `:root` y el color de la empresa no llegaba a botones ni enlaces. Para texto y enlaces se usa una variante ajustada a 4.5:1 sobre el fondo de cada modo. Ojo: el color por omisión de una empresa es ámbar (`#F59E0B`, specs/03), igual que el estado "advertencia". Los estados siempre llevan ícono y texto, pero conviene que el PO elija otro color por omisión.

## F6-T3 — Plantas y clientes

141. **Indicadores en `GET /plants` y `GET /plants/:id`.**
    - Cada planta trae `metrics` (estado actual, energía de hoy, PR corregido de 7 días, desviación y predicción de lavado del último día calculado), calculados en lote para la página.
    - Se agregaron el filtro `health` y los órdenes `pr_7d`, `-pr_7d`, `deviation`, `-deviation` y `days_to_cleaning`. Con ellos se calcula para todas las coincidencias y se pagina en memoria; alcanza para cientos de plantas y se medirá en la prueba de carga (F10-T4).
    - Crear y editar devuelven `metrics: null`.
142. **`GET /me` trae `features.simulator`** (SIMULATOR_ENABLED), para mostrar la marca "Simulador" y su editor de escenarios solo en staging o demo. Una planta que ya es simulada la conserva al editarse.
143. **Campos de credenciales.** Los campos que pide cada portal no están definidos y no se inventan (CLAUDE.md). El formulario pide usuario, contraseña y campos adicionales libres. Al implementar cada adaptador con su documentación oficial se ajustarán los campos y su `credsSchema`. Lo guardado nunca se vuelve a mostrar.
144. **Mensajes de validación en español.** `@pv/core` activa los mensajes en español de zod para toda la plataforma (una sola copia de zod en el monorepo). Antes, un número inválido mostraba "Invalid input: expected number". Además, el frontend valida los campos numéricos antes de enviarlos.
145. **Hora de los eventos.** La hora que se escribe al registrar un evento se interpreta en la zona de la empresa, no en la del navegador.
146. **Eliminar.**
    - Eliminar planta o cliente pide confirmación en dos pasos dentro de la página.
    - Un cliente con plantas no se puede eliminar: la API responde 409 y se muestra el mensaje.
    - Pausar o reactivar una planta es un botón del detalle.

## F6-T4 — Detalle de planta

147. **Potencia esperada de "Hoy".** `05` §1 da la energía esperada por hora corregida por temperatura (sin otras pérdidas). En la gráfica se multiplica por el PR de la línea base de la planta (o 0.85 sin línea base). Así, una planta sana empalma con su curva real y la diferencia que se ve es pérdida real. El valor de referencia se muestra en la gráfica. ¿El PO prefiere la teórica sin pérdidas?
148. **Endpoints.**
    - `GET /plants/:id/today?date=` devuelve los 96 intervalos de 15 min del día local con potencia real y esperada; la web muestra solo las horas con sol o con lecturas. Lo puede usar el técnico con un ticket abierto de esa planta (si no, 404); el resto de `/plants` sigue cerrado para él.
    - `GET /plants/:id/daily-metrics?from&to`: por omisión los 30 días hasta ayer, máximo 366 días. Trae los eventos que reinician la tendencia (limpieza, lluvia, reparación) para marcarlos en la gráfica.
149. **Gráficas.**
    - Son de Recharts, con un solo eje cada una.
    - Colores validados con el validador de paleta: azul para la serie, gris punteado para la referencia y ámbar punteado para el umbral (un paso más oscuro en modo oscuro).
    - Leyenda en texto, tooltip y una tabla con los mismos datos.
    - Los días no válidos no se dibujan. Lluvias y limpiezas se marcan con líneas verticales.
    - La predicción de lavado y las vecinas usan siempre los últimos 30 días; el rendimiento, 30, 90 días o un año.
150. **"Crear ticket" desde la planta.** Resuelto en F6-T5: el detalle de la planta tiene el botón, que abre el formulario con la planta elegida.

## F6-T5 — Alertas y tickets

151. **Pérdida estimada en el detalle de la alerta.** `GET /alerts/:id` trae `estimated_loss` (kWh y MXN por día, con la tarifa usada), calculada con la fórmula de `07` §3 en `packages/core` (`estimatedDailyLossKwh`): promedio en los días disparadores de `expected_temp_kwh × pr_baseline − energy_kwh`; para `offline`, todo lo que debió producir con su rendimiento normal (`expected_temp_kwh × pr_baseline`). Tarifa del cliente o, si no tiene, la de la empresa. Sin datos suficientes es `null` y la pantalla lo dice.
152. **Explicación IA antes de F7.** Mientras no exista `ai.explain_alert`, el detalle muestra un aviso y la evidencia. El botón "Regenerar explicación" se ve deshabilitado. Cuando exista, se muestran `resumen`, `causa_probable`, `confianza`, `otras_causas` y `que_revisar` validados con zod. Lo que no cumpla el esquema no se muestra. Corrección: la descripción prellenada del ticket leía `summary` y el campo de `07` §3 es `resumen`.
153. **Vecinas en la evidencia.** `neighbor_index` (`05`) es el rendimiento de la planta frente a la mediana de sus vecinas, no el de las vecinas. Se muestra como "Frente a sus vecinas: 67 %" (100 % = igual que ellas).
154. **Responsables de un ticket.** El operador no puede listar usuarios (`02`), así que se agregó `GET /tickets/assignees` (requiere `alerts:manage`): usuarios activos técnico, operador o administrador de la empresa, solo id, nombre y rol.
155. **Tablero de tickets.** Muestra los abiertos (pendiente, programado, en curso), hasta 100. Los resueltos y cancelados se consultan en la vista de lista con el filtro de estado.
156. **Formulario de nuevo ticket.** El selector de plantas lista las primeras 100 plantas activas por nombre. Desde el detalle de una planta, "Crear ticket" la deja elegida. Si una empresa supera 100 plantas habrá que cambiarlo por un buscador.
157. **Vista del técnico.**
    - "Mis tickets": tarjetas grandes con la dirección (enlace a Google Maps con las coordenadas, o con la dirección si no hay coordenadas), el teléfono del contacto y "Qué revisar".
    - Botones: iniciar y resolver con notas y la casilla "Se realizó limpieza", marcada por omisión en tickets de lavado. El técnico no puede cancelar.
    - El detalle del ticket muestra la potencia de hoy de la planta; el técnico no ve el resto del detalle de la planta ni las alertas.

## F6-T6 — Configuración y superadmin

158. **Endpoints agregados.**
    - `GET /company/invitations` (solo `company_admin`): invitaciones vigentes sin aceptar, para que el admin vea a quién ya invitó. No expone el token.
    - `GET /company/ai-usage` (solo `company_admin`): uso del mes en la zona de la empresa por función (asistente, explicación de alertas, narrativa de reportes), presupuesto e historial de los 6 meses anteriores.
159. **Umbrales y valores técnicos.** Cada sección se guarda por separado y manda solo los valores que cambiaron; lo demás sigue al valor por omisión del spec. Cada campo muestra su valor por omisión y si está personalizado. "Restablecer" manda la sección en `null` (pide confirmación).
160. **Marca.** El color se elige con selector o en hexadecimal, con vista previa y el contraste del texto sobre él. Al guardar el color o el logo se relee `/me` y la marca cambia en toda la interfaz sin recargar. El logo (PNG, JPG o SVG, hasta 1 MB) se sube como archivo; el cliente de la API ahora envía un `Blob` tal cual con su tipo.
161. **Zonas horarias.** El selector ofrece las de México (Pacífico por omisión); si la empresa tiene otra, se conserva como opción.
162. **Correo que no sale.** Si el proveedor de correo falla al invitar a un usuario o al crear una empresa, la API responde 500 aunque la invitación (o la empresa) ya quedó guardada. Un reintento del admin crea otra invitación; uno del superadmin choca con el slug ya usado. Propuesta para F10: responder 201 con `email_sent: false` y un botón "Reenviar invitación". ¿El PO lo aprueba?
163. **Superadmin.** Ve nombre, slug, plan, número de plantas y tokens de IA del mes de cada empresa; crea empresas con la invitación al primer admin, suspende (cierra sesiones y detiene sus jobs) y reactiva, y cambia plan y presupuesto. No entra a los datos de las empresas (`02`). En "Salud del sistema" las horas se muestran en la zona del navegador, porque el superadmin no tiene empresa.
164. **Mensaje de correo inválido.** El locale de zod en español decía "Inválido dirección de correo electrónico"; los correos de alertas ahora responden "Correo inválido", como el resto de la API.
165. **Criterio de la Fase 6 (360 px y modo oscuro).** Barrido con Chromium de todas las vistas: tablero, plantas (lista, detalle, nueva), clientes (lista, detalle, nuevo), alertas (bandeja y detalle), tickets (lista, detalle, nuevo), configuración, asistente y reportes (pendientes de F8 y F9), la vista del técnico y las dos de superadmin, en 360 px claro, escritorio oscuro y 360 px oscuro: 114 verificaciones sin fallas (sin scroll horizontal, contraste AA del texto visible, sin errores de JavaScript). Se corrigió la atribución de los mapas (los enlaces de Leaflet quedaban en 3.6:1).

## F7 — IA: explicación de alertas

166. **Temperatura.** `07` §1 incluye `temperature` en la interfaz y §3 pide ≈ 0.2. Desde el 2026-10-21 la API de Claude rechaza `temperature` en todos los modelos (y los modelos 5.5 ya no la aceptaban). No se envía: la consistencia sale de la salida estructurada (JSON Schema), el esfuerzo `low` y la validación. `LLMRequest` tiene `effort` en lugar de `temperature`. **El PO/Arquitecto debe actualizar `07`.**
167. **Validación de cifras.** Un número del texto es válido si coincide, redondeado a los decimales con que se escribió, con alguna cifra de los datos que recibió la IA (evidencia, pérdida y datos técnicos de la planta), tal cual o como porcentaje de una fracción (0.86 → 86 %). Días y conteos también pueden salir de las fechas y del tamaño de las listas. Los porcentajes y los montos ($) solo de cifras. Los enteros del 0 al 5 se aceptan siempre ("lavar y revisar en 1–2 días", como el ejemplo de `07`). Límite conocido: sin unidades, "20 %" pasa si 20 es otra cifra de los datos (por ejemplo, 20° de inclinación).
168. **Correo de alerta nueva.** Ahora lo manda `ai.explain_alert` al terminar, con el `resumen` (de la IA o de la plantilla), para cumplir "el correo muestra el resumen" (`07` §3). Las reglas de a quién y cuándo avisar no cambian (`06` §6). El job no falla por la IA (usa la plantilla) y se reintenta 2 veces ante errores de base; si aun así falla, la alerta queda sin correo y el fallo se ve en "Salud del sistema".
169. **Proveedor simulado.** Con `LLM_PROVIDER=mock` la IA no responde y todo usa la plantilla (`ai_status = failed`). La semilla de demo explica en línea sus alertas abiertas (no encola el job, para no gastar tokens dos veces); con el simulado quedan con plantilla, y la pantalla dice "automático, sin IA".
170. **Presupuesto.** Cuentan los tokens de entrada (incluida la caché) más los de salida. Con el presupuesto agotado la explicación usa la plantilla sin llamar a la IA (`ai_status = skipped`). Al cruzar el 80 % se manda un correo a los `company_admin` una sola vez por mes. El bloqueo del chat al 100 % llega con F8.
171. **Regenerar.** Máximo 3 por alerta en el día local de la empresa, contados en `audit_logs` (`alert.explanation_regenerated`); el cuarto responde 429. Solo alertas abiertas, warning o critical. La página consulta la alerta cada 4 s mientras `ai_status = pending` (hasta ~100 s).
172. **Modelos y fallas.** Explicaciones con `LLM_MODEL_FAST` (por omisión `claude-haiku-5-5`) y esfuerzo `low`. El SDK reintenta una vez los errores de red, 429 y 5xx, con 60 s por llamada. Una negativa del modelo (`refusal`) o un error del proveedor van directo a la plantilla, sin el reintento de validación. Caché del prompt en el sistema y las herramientas.
173. **Datos que recibe la IA.** Tipo y severidad, evidencia y pérdida estimada, kWp, inclinación, orientación, antigüedad y marca de inversor, eventos de 90 días y tickets recientes (tipo, estado y fecha). Nunca nombres de clientes, teléfonos, direcciones ni credenciales (prueba en `notifications.int.test.ts`).

## F8 — Asistente analítico

174. **Periodos.** "Últimos 7/30 días" terminan ayer (último día completo, como el tablero); "hoy", "este mes" y "este año" llegan a hoy, cuyo día puede estar incompleto. Cada salida dice el periodo usado con sus fechas, para que el asistente lo indique.
175. **Métricas de las herramientas.** Estado actual como el tablero (alertas abiertas y último día reciente). `availability_pct` = días con datos menos días offline entre los días del periodo. `specific_yield` = energía de todos los días con métricas entre kWp. En zonas, comparaciones y flota, el PR es Σ energía / Σ esperada de los días válidos de todas las plantas (`07` §2), sin promedios de PR.
176. **Pérdida en `get_plants_at_risk`.** Con alerta, la de la alerta más grave (`07` §3). Sin alerta (solo lavado previsto), la de sus últimos 3 días válidos con la misma fórmula. Se marca como estimación.
177. **Esquemas para el modelo.** Las fechas se validan con un patrón simple (`YYYY-MM-DD`) más una revisión al resolver el periodo. El patrón completo de zod multiplicaba el tamaño del esquema que se manda en cada llamada.
178. **Chat: modelo y respaldo.** El chat usa `LLM_MODEL_CHAT` (por omisión `claude-sonnet-5-5`) con esfuerzo `medium` (uso de herramientas en varios pasos) y el respaldo del servidor ante negativas (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Si las salvaguardas del modelo declinan una pregunta legítima, la API la reintenta en otro modelo dentro de la misma llamada. Se puede quitar si el PO lo prefiere.
179. **Ciclo agente.** Hasta 6 rondas de herramientas. Si el modelo pide más, recibe "se alcanzó el límite; responde con lo que tienes" y una última oportunidad; si insiste, el usuario ve un aviso. Máximo 3 gráficas por respuesta y 30,000 caracteres por resultado de herramienta. Los errores de validación de una herramienta vuelven al modelo (`is_error`) para que corrija.
180. **Historial y guardado.** El modelo recibe los últimos 20 mensajes (texto, y las gráficas como "[Gráfica: título]"), sin resultados de herramientas anteriores. Se guardan la pregunta, cada llamada a herramienta (entrada y un resumen de la salida de hasta 1,000 caracteres) y la respuesta con tokens y latencia. El título de la conversación son los primeros 60 caracteres de la primera pregunta.
181. **Límites.** 30 preguntas por hora por usuario, contadas en `ai_messages` (sirve con varias instancias de la API). Con el presupuesto agotado, `POST /ai/chat` responde 429 `AI_BUDGET_EXHAUSTED` y la pantalla lo explica. Al cruzar el 80 % se avisa a los `company_admin` una vez por mes, igual que en las explicaciones.
182. **Enlaces y markdown.** La respuesta se muestra como markdown sin HTML ni imágenes. Solo se enlazan los nombres de planta que vinieron en los datos de las herramientas (a `/plants/:id`); un enlace externo que escriba el modelo se muestra como texto. Un nombre de planta con formato markdown se escapa.

## F9 — Reportes mensuales

183. **Días nublados y con lluvia.** `08` no los define. Un día es nublado si la nubosidad promedio de las plantas del cliente es ≥ 60 %, y con lluvia si alguna planta registró ≥ 1 mm. El mejor día es el de más energía total; el peor día válido, el de menos energía entre los días en que todas las plantas tuvieron día válido.
184. **Disponibilidad.** Horas con sol (la mitad o más de la hora con el sol arriba) que tuvieron al menos una lectura, entre las horas con sol del periodo, desde el día de alta si la planta se instaló a mitad de mes.
185. **Pendientes del mes (`open_issues`).** Alertas detectadas antes del fin de mes que seguían abiertas al cerrarlo, como "planta: tipo" en palabras simples.
186. **Narrativa.** `LLM_MODEL_FAST`, esfuerzo `low`, sin `temperature` (la API ya no la acepta; ver #166). Se rechaza el texto con menos de 60 o más de 180 palabras (se piden 80–150), con jerga ("PR", "irradiancia", "kWp") o con cifras que no están en `facts`; se reintenta una vez con la corrección y después se usa la plantilla (`narrative_source = template`).
187. **Pie del PDF sin datos de contacto.** `08` §4 pide los datos de contacto de la empresa, pero `companies` no tiene teléfono, correo ni dirección. El pie lleva el nombre de la empresa, el aviso de privacidad breve y la nota de la tarifa. **Pregunta al PO:** ¿agregamos campos de contacto en Configuración → Empresa?
188. **Fuente y logo del PDF.** Inter embebida (subconjunto latino, ~20 KB por PDF): acentos, ñ, ¿ y ¡ sí; el subíndice de CO₂ no, así que el PDF dice "CO2". Solo se incrustan logos PNG o JPG (react-pdf no dibuja SVG); con logo SVG el encabezado lleva solo el nombre. La llave del logo se arma con el `company_id` del reporte, nunca con la de la URL guardada. El PDF se guarda en `reports/{company_id}/{periodo}/{id}.pdf`.
189. **Envío automático.** Con `auto_send_client_reports`, solo los reportes que crea el job del día 1 se envían solos al generarse. Generar o regenerar a mano nunca envía: el envío manual es otro paso explícito.
190. **Un reporte enviado queda fijo.** No se regenera ni se reenvía (`08` §1 permite regenerar "mientras no se haya enviado"). Si el cliente lo pide de nuevo, se descarga el PDF y se manda aparte. **Pregunta al PO:** ¿queremos "Reenviar"?
191. **Envío y auditoría.** `POST /reports/:id/send` y "Enviar todos" registran `report.sent` (uno por reporte) al pedirlo y encolan `reports.send`. El reporte pasa a `sent` cuando el proveedor de correo acepta el mensaje. Cada intento queda en `notifications` (`client_report`). Si falla tras los reintentos, la pantalla avisa "El último envío falló" y se puede volver a enviar; el reintento usa la misma fila.
192. **Correo al cliente.** Asunto "Reporte de generación solar de {mes de año} — {empresa}", saludo con el nombre del cliente, dos frases y el PDF adjunto (`Reporte-solar-AAAA-MM.pdf`). Sin enlaces a la plataforma: el cliente final no tiene cuenta. Los adjuntos van por Resend (`attachments` con `filename`, `content` en base64 y `content_type`) o SMTP (nodemailer).
193. **Lista de reportes.** Muestra los clientes con al menos una planta activa en el mes (más los reportes existentes de clientes que ya no cuentan) y se abre en el último mes cerrado. Solo se generan meses terminados en la zona de la empresa (422 `PERIOD_NOT_CLOSED`). La vista previa descarga el PDF con la sesión y lo muestra en la página; el PDF se sirve con `Cache-Control: private, no-store`.

## F10 — Endurecimiento

194. **Revocación inmediata (resuelve #23 y #37 con la opción conservadora).** Cada petición autenticada revisa en la base que el usuario siga activo, que su empresa siga activa y que pertenezca a la misma empresa del token. El rol se toma de la base, no del token. Desactivar a alguien, suspender una empresa o bajar un rol aplica en la siguiente petición. Costo: una consulta por clave primaria por petición. La regla LAST_ADMIN se conserva como defensa en profundidad, aunque ya no es alcanzable desde la API.
195. **Escaneo de secretos y dependencias en CI.** gitleaks 8.24.3 (binario con checksum verificado) revisa todo el historial; `pnpm audit --audit-level critical` revisa las dependencias. Los falsos positivos revisados quedan en `.gitleaksignore` con su razón. Se eligió bloquear solo vulnerabilidades críticas, como pide `12` §3; las altas se revisan a mano en cada fase.
196. **Limpieza de telemetría (F10-T2).** Job mensual el día 2 a las 09:45 UTC (02:45 en Culiacán). Borra las lecturas de 15 min anteriores al mismo día de hace 13 meses, en la zona de la empresa, planta por planta en transacciones cortas (también de plantas dadas de baja o eliminadas). Se conservan las métricas diarias, el clima por hora, los eventos y `job_runs`: `03` solo fija retención para la telemetría cruda. Las empresas suspendidas no se limpian mientras estén suspendidas. `metrics.recompute` no recalcula días anteriores al corte, porque los dejaría sin datos y pisaría sus métricas. **Pregunta al PO:** ¿retención para `plant_weather_hourly` y `job_runs`?
197. **Respaldo lógico con RLS forzado (F10-T3).** Las tablas de empresa tienen `FORCE ROW LEVEL SECURITY`, así que el dueño también está sujeto a RLS y `pg_dump` falla con ese rol. Un respaldo lógico necesita un rol superusuario o con `BYPASSRLS`. Se elige no quitar `FORCE`, porque es la capa que protege si alguien conecta la aplicación con el rol dueño. **Pregunta al PO / equipo:** confirmar en staging si el usuario de Render puede crear un rol `pv_backup` con `BYPASSRLS`. Si no puede, los respaldos dependen solo de los de Render, y la prueba de restauración se hace restaurando uno de esos respaldos en una base nueva y corriendo allí las verificaciones del script.
198. **Prueba de carga (F10-T4).** Se mide con el simulador, que tarda unos 100 ms por planta (lee el clima de la base y guarda las lecturas). Un proveedor real agrega la latencia de su API: con concurrencia 5, el ciclo de 500 plantas toma unos 500 × latencia / 5. Cumple los 5 min mientras la latencia media sea menor de 3 s por planta. Se debe repetir la medición con el primer adaptador real (F10-T6) y, si hace falta, subir `concurrency` de `ingest.telemetry_plant` dentro del límite del proveedor. El tablero se mide con 90 días de métricas de 500 plantas y 25 alertas abiertas.
199. **Aviso de privacidad y términos (F10-T5).** Páginas públicas `/privacidad` y `/terminos`, enlazadas desde todas las pantallas de acceso, desde la aceptación de invitación ("Al crear tu cuenta aceptas…") y desde la barra lateral. El texto vive en `apps/web/src/content/legal.ts`. Es un **borrador** con la estructura de la LFPDPPP: responsable y encargado, datos, finalidades, encargados que reciben datos, conservación, derechos ARCO y cambios. Describe lo que la plataforma hace de verdad: la IA no recibe datos de contacto y la telemetría se conserva 13 meses. Las páginas muestran el aviso de borrador mientras `LEGAL_DRAFT = true`. **Pendiente del PO / área legal:** razón social, domicilio, correo de privacidad, proveedores y países, plazos tras terminar el servicio, ley aplicable, y quitar el borrador. **Pregunta:** ¿guardar en la base la versión aceptada por cada usuario al crear su cuenta? Hoy solo se muestra la leyenda.
200. **Marcas de la empresa piloto.** El equipo indicó que usa principalmente GoodWe, Growatt y Victron. Se agregaron `growatt` y `victron` al catálogo (migración `20261024120000_inverter_brands`), a los formularios y filtros, y se mostraron primero. Sus adaptadores, como el de GoodWe, existen pero responden "no implementado" hasta tener la documentación oficial (CLAUDE.md). Mientras tanto, una planta de esas marcas se registra con sus datos técnicos, pero no se lee su telemetría; la regla offline no la marca, porque la ingesta la salta. Huawei, Fronius y Enphase se conservan (quitar valores del enum es destructivo). **Pendiente del equipo, por marca:** documentación oficial de su API de monitoreo, una cuenta de prueba con al menos un inversor, y cuál conviene implementar primero (la de más plantas).
201. **Staging en Render (F0-T4, 2026-11-02).** Desplegado con el Blueprint. Resuelve #14: el usuario dueño de Render sí puede crear roles; la migración `rls` creó `pv_app` y `pv_service`, y después se crearon `pv_app_login` y `pv_service_login`. Hallazgos del despliegue: (1) un grupo de variables de Render solo admite `value` y `generateValue` (se corrigió `render.yaml`); (2) la primera migración puede fallar con P1001 si la base aún se está creando, y se resuelve con un nuevo despliegue; (3) `pv-web` no se creó en la primera sincronización y se creó con *Manual sync*; (4) el superadmin se creó por SQL con `pv_service_login`, porque el dueño está sujeto a RLS en `users`. Resend queda pendiente: con valores provisionales, crear empresas o invitar responde con error al enviar el correo.
202. **Fallas del proveedor de correo (staging, 2026-11-02).** Con Resend rechazando el envío (403), "Recuperar contraseña" respondía 500. Eso contradecía `10` ("siempre responde 200") y revelaba qué correos tienen cuenta. Ahora: (1) la recuperación responde igual exista o no la cuenta, y la falla queda en el log sin el enlace; (2) crear empresa e invitar usuario guardan el registro y responden `email_sent: false`, y la pantalla avisa que el correo no salió (se puede volver a invitar). **Pendiente:** el superadmin no tiene botón para reenviar la invitación al primer administrador de una empresa. Hoy se resuelve con SQL. ¿Lo agregamos?
203. **Datos de ejemplo en una empresa existente.** En staging (`SIMULATOR_ENABLED=true`), el superadmin puede cargar datos de ejemplo en una empresa **vacía** (sin plantas): botón "Cargar datos de ejemplo" → job `demo.example_data`. Usa los mismos escenarios que la demo de Culiacán: 20 clientes, 25 plantas simuladas y 90 días de historia calculados con el pipeline real (alertas, explicaciones, un ticket), más los reportes del mes pasado. Para que los tickets tengan a quién asignarse, crea un operador y dos técnicos de ejemplo sin contraseña (no pueden entrar). El clima de la historia es sintético; desde ese momento el worker sigue con el proveedor real. No envía correos. No está disponible en producción ni en una empresa con plantas, para no mezclar datos reales con datos de ejemplo. Los datos de ejemplo no se borran solos.
204. **Tiempos de atención de tickets.** Pedido del PO. Se agrega `maintenance_tickets.started_at`, que se llena la primera vez que el ticket pasa a "En curso"; repetir "En curso" no reinicia el reloj. Los tiempos son funciones puras en `core` (`ticketDurations`, `durationStats`):
    - **Trabajo:** de iniciado a resuelto.
    - **Espera:** de creado a iniciado.
    - **Total:** de creado a resuelto.

    Se reporta el promedio y la **mediana**, porque un ticket olvidado varios días distorsiona el promedio. Los tickets anteriores al cambio no tienen inicio y no cuentan en el tiempo de trabajo. Los datos de ejemplo incluyen 5 tickets ya resueltos con sus tiempos. **Pregunta:** ¿se necesita también una meta (SLA) por prioridad, por ejemplo resolver una alta en 24 h, con aviso si se vence?
205. **Ayudas en pantalla y documentación.** Ícono ⓘ con una explicación corta en el tablero, la planta y sus gráficas, la alerta, los tiempos de tickets y los reportes. Los textos viven en `apps/web/src/lib/help.ts` y coinciden con `docs/glosario.md`. Guías nuevas: `docs/arquitectura.md`, `docs/glosario.md` y `docs/pantallas.md` (con roles y cómo llenar los formularios).
206. **Aceptación de términos (plan 3.5).** `LEGAL_VERSION` en `core` es la versión vigente. Al aceptar una invitación es obligatorio marcar la casilla. Quien no ha aceptado la versión vigente ve una pantalla para aceptarla antes de usar la plataforma: usuarios creados por SQL, anteriores al cambio, o cuando cambie la versión. Se guarda `users.terms_version` y `terms_accepted_at`, y el historial con IP en la auditoría (`legal.accepted`). La API no bloquea otras rutas a quien no ha aceptado, solo la interfaz; si el abogado lo pide, se bloquea también la API.
207. **Importación masiva (plan 6.4).** `POST /plants/import` recibe el CSV como texto (hasta 2 MB y 2,000 renglones):
    - Cada renglón es una planta con los datos de su cliente.
    - Los clientes se agrupan por nombre, sin importar mayúsculas ni acentos. Un cliente que ya existe no se modifica.
    - Se valida con los mismos esquemas que los formularios.
    - `dry_run` solo revisa; sin él guarda todo en una transacción, o nada si hay errores.
    - Acepta archivos de Excel en español: `;`, coma decimal, fechas día/mes/año y codificación Windows-1252.
    - Las plantas simuladas reciben un perfil normal.
    - Encola el clima de 90 días de cada planta.

    **Pregunta:** ¿se necesita también importar credenciales de inversores? No se incluyó a propósito, para no mover contraseñas en archivos de Excel.
208. **Plan de incidentes y rotación de la llave de credenciales (plan 1.11).** `docs/respuesta-incidentes.md` es un borrador operativo: contactos, niveles, pasos, contención, consultas a `audit_log` y avisos.
    - `CREDENTIALS_PREVIOUS_KEYS` ("versión:llave", separadas por comas) permite leer lo cifrado con llaves anteriores mientras dura la rotación.
    - `pnpm credentials:rotate` vuelve a cifrar con la llave actual las credenciales de todas las empresas (también las suspendidas); termina con error si a alguna le falta su llave.
    - **Pregunta:** el compromiso de aviso a las instaladoras (72 horas propuestas) y quién avisa a los titulares los define el abogado en el contrato de encargo.
209. **Producción separada (plan 1.9).** `render.production.yaml` es una copia de `render.yaml` con nombres `pv-prod-*` (conviven en el mismo workspace), rama `main`, `SIMULATOR_ENABLED` fijo en `false`, `WEATHER_API_KEY` y los mosaicos comerciales, y una base `basic-1gb`. La guía es `docs/produccion-render.md`.
    - Los dos archivos se mantienen a mano; una diferencia no deseada entre ellos no la detecta CI.
    - **Pregunta:** el tamaño de la base de producción se ajusta con la hoja de costos (`docs/costos.md`).
210. **Exportar y borrar definitivamente una empresa (plan 3.7).**
    - **Exportar** (`company.export`, solo company_admin): un ZIP con un CSV por tabla, leído con withTenant en páginas. Excluye contraseñas, credenciales de inversor, tokens, invitaciones pendientes y los PDF de los reportes (sus cifras y textos sí van). La llave del archivo queda en `job_runs.stats`; se conserva solo la última exportación y se descarga 7 días. Los textos que Excel ejecutaría como fórmula llevan un apóstrofo.
    - **Borrar** (`company.purge`, solo superadmin, empresa suspendida y confirmación con el slug): borra archivos (logo, PDFs, exportaciones), los datos operativos con pv_app y luego, con pv_service, auditoría, usuarios y la empresa. Queda un registro de plataforma `company.purged` con nombre, slug y conteos.
    - Nueva migración `company_purge`: pv_service obtiene DELETE sobre `companies`, `users`, `invitations`, `job_runs` y `audit_log`, limitado por una política restrictiva a filas de empresas suspendidas. La auditoría de una empresa activa sigue sin poder borrarse.
    - Un job pendiente de una empresa ya borrada se registra como omitido sin `company_id`.
    - **Preguntas al PO / abogado:** plazo entre suspender y borrar; si la auditoría de la empresa debe conservarse un tiempo después del borrado (hoy se borra, y la empresa la recibe en su exportación); ¿hace falta exportar un solo cliente (derecho de acceso de un titular)?; ¿incluir los PDF de los reportes en el ZIP? Hoy no, por tamaño. El ZIP se arma en memoria: con cientos de plantas y 13 meses de lecturas puede pesar decenas de MB, y debe medirse en staging con la hoja de costos.
211. **Hoja de costos (plan 5.1).** `pnpm costs:report` mide por empresa plantas, lecturas por día, tokens de IA por función, correos y archivos. Con `--prices` calcula el costo en USD con `companyMonthlyCost` (`packages/core/src/costs.ts`): IA por modelo, correos, almacenamiento y los costos fijos repartidos por plantas. Los precios van en un JSON que llena el equipo (`docs/costos-precios.example.json`). Solo vienen llenos los de la API de Anthropic, tomados de su referencia (2026-10-06). Los de Render, R2, Resend, Open-Meteo y mapas quedan en 0 para llenarse con sus páginas oficiales. El tamaño de los PDF se supone (150 KB por defecto). **Pendiente del equipo:** llenar precios, medir en staging un mes y repetir con el piloto.
212. **Victron (VRM API): revisión de la documentación oficial (2026-11-03).** Resumen en `docs/fabricantes/victron-vrm.md`.
    - Autenticación: token de acceso en el encabezado `x-authorization: Token …`.
    - Límite: unas 3 peticiones por segundo; 429 con `Retry-After`.
    - Serie de 15 min: `GET /installations/{idSite}/stats`, máximo 31 días por consulta.
    - Credenciales propuestas por planta: `access_token` e `id_site`.
    - **Pendiente, con una cuenta de prueba:** qué códigos de atributo trae la producción FV, si cada punto es energía o potencia, y si los timestamps de `stats` van en segundos o milisegundos (la documentación no lo dice).
    - **Pendiente del equipo:** confirmar por escrito con Victron el uso comercial por un tercero. La API es pública, pero sin soporte.
213. **GoodWe (OpenAPI de SEMS): revisión de la documentación oficial (2026-11-03).** Resumen en `docs/fabricantes/goodwe-openapi.md`.
    - El acceso **se solicita a GoodWe**, que entrega un Client ID y un Client Secret.
    - Serie de 1 minuto por planta, en kW, hasta 100 plantas y 24 h por consulta. Energía del día por inversor, con historial desde 2025-01-01. Alarmas con código.
    - Solo un token activo por Client ID: el worker debe compartirlo.
    - **Decisión del PO:** ¿cada instaladora solicita acceso como *usuario de organización* con su cuenta SEMS+ (credenciales por empresa, que hoy no existen en PV-IoT), o PV-IoT se registra como *tercero* y cada cliente final autoriza con OAuth?
    - **Pendiente con GoodWe:** límite de peticiones, formato de `Request-Id`, servidor para México, y las contradicciones de unidades y formato listadas en el documento.
214. **GoodWe: llaves por empresa (decisión del PO, 2026-11-03).** Cada instaladora solicita a GoodWe su acceso como *usuario de organización* y captura en **Configuración → Integraciones** su Client ID, su Client Secret y el servidor.
    - Tabla `company_integrations`: una fila por empresa y fabricante, cifrada como `inverter_credentials`. El cifrado queda ligado a la empresa y al proveedor.
    - Las llaves entran en la rotación de la llave de cifrado y en el borrado definitivo, y nunca salen en la exportación.
    - Rutas `/company/integrations`, solo para company_admin.
    - "Probar conexión" pide el token (*client credentials*) y la primera página de plantas, como dice la documentación.
    - Cada planta se ubicará por el número de serie de su inversor (`searchType` 3 de `base-info/plants`), sin credenciales por planta.
    - La lectura de la serie de potencia sigue pendiente de una cuenta aprobada (#213).
    - **Riesgo anotado:** GoodWe admite un solo token activo por Client ID. La API (Probar conexión) y el worker son procesos distintos y cada uno pide el suyo; uno puede invalidar el del otro, y el cliente lo renueva una vez ante el error `10002`. Al programar la ingesta conviene un token compartido por empresa.
215. **Victron: adaptador parcial (2026-11-03).**
    - Hechos: credenciales por planta `{access_token, id_site}` (validadas al guardar) y "Probar conexión" con `/users/me` y `/users/{idUser}/installations?idSite=`.
    - El contrato de los adaptadores gana `credentialsSchema` opcional; la API valida con él al guardar.
    - `fetchReadings` sigue pendiente (#212). La ingesta omite esas plantas como `adapter_not_implemented`.
    - Para cerrarlo: correr `pnpm victron:probe --site <idSite>` con un token real y entregar el archivo que genera (no contiene el token).
216. **Victron: lectura de datos con respuestas reales (2026-11-03).**
    - El PO no tiene todavía una cuenta Victron. Victron no documenta una cuenta de prueba, así que, solo para diagnóstico, se usó el acceso demo público de VRM (`/auth/loginAsDemo`). No está en la especificación y el producto no lo usa.
    - Confirmado: `live_feed.total_solar_yield` es kWh por intervalo de 15 min; `start` y `end` van en segundos y la respuesta en milisegundos; el timestamp es el inicio del intervalo; los intervalos sin producción no vienen.
    - `fetchReadings` entrega kW medios (kWh × 4), sin contador diario ni temperatura. Pide desde el cuarto de hora, descarta el intervalo en curso y parte las ventanas en tramos de 31 días. Respuesta real grabada como ejemplo de prueba.
    - **Pendiente:** validar con una instalación propia en México (horarios y producción) y la temperatura del inversor. Los intervalos de madrugada o atardecer con producción cero no llegan, y cuentan como faltantes en la completitud del día; con el umbral de 80 % no debería invalidar días normales. Revisarlo con datos reales.
217. **Plantas con batería o límite de inyección (2026-11-04).** El PO pidió marcar estas plantas para evitar alertas falsas en el piloto: el inversor reduce la producción a propósito cuando la batería está llena o no se puede inyectar a la red.
    - Campos `has_battery` y `export_limited` en `solar_plants`, en el formulario y en la importación (columnas `con_bateria` y `limite_inyeccion`, sí o no).
    - Con cualquiera de los dos: sin `sudden_drop`, `soiling` ni `cleaning_due_soon` (las abiertas se resuelven solas), sin predicción de lavado y sin afectar el estado diario. La planta tampoco sirve de vecina ni cuenta para el evento de zona (`06` §2).
    - Se eligió omitir toda la planta, y no solo los ratos limitados, porque hoy no se lee el estado de la batería. Es la opción conservadora: es preferible no alertar a alertar en falso.
    - **Pregunta:** ¿se quiere, para estas plantas, un aviso más suave, por ejemplo "rendimiento bajo varios días seguidos, revisar en sitio", que no hable de suciedad? Hoy no reciben ninguno de rendimiento.

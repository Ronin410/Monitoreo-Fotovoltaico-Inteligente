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
100. **Escenarios visibles.** La lluvia lava los paneles, así que a las 4 plantas con suciedad se les asignan los puntos con la lluvia más antigua: se consulta el clima de 14 puntos candidatos. La suciedad empieza el día siguiente a la última lluvia, con la tasa que deja la pérdida pedida hoy (3 %, 7 %, 10.5 % y 16 %). Otras fechas: la falla de string reciente es de hace 3 días y la antigua de hace 25; la planta queda offline desde las 09:00 de hace 2 días; la sombra de la tarde empieza hace 30 días; las 2 plantas nuevas se instalaron hace 9 y 6 días.
101. **Re-ejecución.** La semilla no borra nada: si ya existen las empresas demo, termina con un mensaje. Se niega a correr con `NODE_ENV=production`. Las métricas llegan hasta ayer (día local completo). Los correos usan el dominio reservado `demo.pv-iot.example`.
102. **Hash de contraseñas compartido.** `hashPassword` y `verifyPassword` (argon2id) se movieron a `@pv/adapters` para que la semilla del worker use exactamente los mismos parámetros que la API.

## Revisión de la Fase 4

103. **Falla de string frente a tendencia de suciedad.** Una caída brusca (falla de string) entra en la regresión de `05` §7 como si fuera suciedad y da `days_to_cleaning = 0`. Propuesta conservadora para F5: con una `sudden_drop` abierta no se emite `cleaning_due_soon`, y los días con `sudden_drop` activo se excluyen también de los puntos de la tendencia (igual que de la línea base). ¿Lo confirma el PO?

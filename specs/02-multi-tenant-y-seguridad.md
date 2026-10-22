# 02 — Multiempresa y seguridad

## Modelo de tenencia
- **Tenant = empresa instaladora** (`companies`).
- Un esquema de base de datos compartido; **toda tabla de negocio tiene `company_id NOT NULL`**, incluso las que podrían deducirlo por relación (telemetría, métricas, alertas). Esto simplifica los filtros y RLS.
- Jerarquía: `company → clients → solar_plants → telemetría, clima, métricas, alertas, tickets`.
- Un usuario pertenece a **una sola empresa** (excepto `superadmin`, que no pertenece a ninguna).

## Aislamiento en dos capas (ambas obligatorias)

### Capa 1 — Aplicación
- Middleware `requireAuth` obtiene `userId`, `companyId` y `role` del JWT y los guarda en el contexto de la petición.
- Todo acceso a datos pasa por `packages/db` usando `withTenant(companyId, fn)`. Los repositorios **exigen** `companyId` y lo agregan a cada `where`.
- Prohibido aceptar `company_id` en el body, query o params para usuarios no superadmin.
- Un recurso de otra empresa responde **404** (no 403), para no revelar que existe.
- Las herramientas de IA reciben el `companyId` desde el servidor, nunca de los argumentos que genera el modelo.

### Capa 2 — PostgreSQL Row Level Security
- RLS activado en todas las tablas con `company_id`.
- Política: `company_id = current_setting('app.company_id')::uuid`.
- `withTenant` abre una transacción y ejecuta `SELECT set_config('app.company_id', $1, true)` antes de las consultas (válido solo dentro de la transacción, seguro con pooling).
- El rol de base de datos de la aplicación **no** es dueño de las tablas ni tiene `BYPASSRLS`. Las migraciones usan otro rol.
- El superadmin y los jobs globales usan una conexión separada con un rol de servicio, solo para operaciones de plataforma (crear empresas, listar empresas, encolar jobs por empresa). Los jobs por empresa vuelven a usar `withTenant`.

Prueba obligatoria: con dos empresas sembradas, cada endpoint y cada herramienta de IA debe fallar al intentar leer o modificar datos de la otra (ver `12`).

## Autenticación
- Correo + contraseña. Hash con **argon2id**.
- Access token JWT de 15 minutos (en memoria del frontend) + refresh token de 30 días en cookie `httpOnly`, `Secure`, `SameSite=Lax`. Los refresh tokens rotan en cada uso y se guardan con hash en `refresh_tokens` (para poder revocarlos).
- Rate limit en login: 5 intentos por minuto por IP y por correo.
- Recuperación de contraseña por correo con token de un solo uso (expira en 1 hora).
- **Invitaciones:** `company_admin` invita por correo con rol asignado; el enlace expira en 7 días.
- El superadmin crea una empresa junto con su primer `company_admin` (invitación).

## Autorización por rol
| Acción | superadmin | company_admin | operator | technician |
|--------|:---:|:---:|:---:|:---:|
| Crear y suspender empresas | ✅ | | | |
| Configurar empresa (marca, umbrales, tarifas) | | ✅ | | |
| Gestionar usuarios de la empresa | | ✅ | | |
| CRUD clientes y plantas | | ✅ | ✅ | |
| Capturar o reemplazar credenciales de inversor | | ✅ | ✅ | |
| Ver tablero, plantas, alertas | | ✅ | ✅ | solo plantas de sus tickets |
| Gestionar alertas y crear o asignar tickets | | ✅ | ✅ | |
| Actualizar tickets asignados | | ✅ | ✅ | ✅ |
| Usar asistente IA | | ✅ | ✅ | |
| Generar y enviar reportes | | ✅ | ✅ | |

El superadmin **no** ve datos operativos de las empresas en v1 (solo nombre, estado, conteo de plantas, uso de IA y salud de los jobs). Si se requiere soporte, se hace con un "modo soporte" registrado en auditoría (v2).

## Credenciales de inversores
- Tabla separada `inverter_credentials`. Se cifran con **AES-256-GCM** (`CREDENTIALS_ENC_KEY`), con IV aleatorio por registro y `key_version` para rotación.
- La API acepta credenciales **solo de escritura**: nunca las devuelve; la respuesta solo indica `has_credentials: true` y `updated_at`.
- Solo el worker las descifra, en memoria, al momento de llamar al proveedor.
- Al guardarlas se ofrece el botón "Probar conexión", que llama al adaptador y regresa solo éxito o error genérico.

## Otros controles
- CORS restringido a `APP_URL`.
- Helmet con encabezados de seguridad por defecto.
- Validación `zod` de toda entrada; límites de tamaño de body.
- Subida de logos: solo PNG, JPG o SVG saneado, máximo 1 MB.
- Rate limit del asistente IA por usuario y presupuesto mensual de tokens por empresa (ver `07`).
- Tabla `audit_log` para acciones sensibles: login, cambios de usuarios y roles, credenciales, umbrales, eliminación de plantas, envío de reportes.
- Borrado lógico (`deleted_at`) en clientes y plantas.
- Backups diarios de la base de datos (configuración de Render) y prueba documentada de restauración.

## Datos personales
Los clientes finales son personas físicas: nombre, teléfono, correo y domicilio. Mostrar aviso de privacidad en la plataforma y en los reportes. Al llamar a la IA se envía el mínimo necesario; en el chat se permiten nombres de planta y cliente, pero **no** teléfonos ni correos (las herramientas no los devuelven).

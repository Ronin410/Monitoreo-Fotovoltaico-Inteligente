# @pv/db

Esquema Prisma, migraciones, cliente y aislamiento entre empresas (ver `specs/02` y `specs/03`).

## Roles de base de datos

| Rol                                                      | Uso                                                                  | Acceso                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| dueño (el usuario que crea Render o `postgres` en local) | Solo migraciones (`MIGRATION_DATABASE_URL`)                          | Dueño de las tablas; también sujeto a RLS (`FORCE`)                    |
| `pv_app`                                                 | api y worker (`DATABASE_URL`)                                        | Solo filas de la empresa fijada en `app.company_id`; sin `BYPASSRLS`   |
| `pv_service`                                             | Superadmin, autenticación antes de conocer la empresa, jobs globales | Solo tablas de plataforma; lectura de plantas y uso de IA para conteos |

`pv_app` y `pv_service` son roles de grupo sin `LOGIN` que crea la migración `rls`. Los usuarios de conexión se crean una sola vez por ambiente, con el rol dueño:

```sql
CREATE ROLE pv_app_login LOGIN PASSWORD '<contraseña larga>' IN ROLE pv_app;
CREATE ROLE pv_service_login LOGIN PASSWORD '<otra contraseña larga>' IN ROLE pv_service;
```

`DATABASE_URL` debe usar `pv_app_login`. `assertAppRoleIsSafe(db)` verifica al arrancar que la conexión no sea superusuario, no tenga `BYPASSRLS`, no sea dueña de tablas y sea miembro de `pv_app`.

## Acceso a datos

Todo acceso a datos de una empresa pasa por `withTenant(db, companyId, fn)`:

1. Abre una transacción y ejecuta `set_config('app.company_id', companyId, true)` para RLS.
2. Entrega un cliente que agrega `companyId` a cada `where` y `data`, y lanza `TenantViolationError` si alguien intenta usar otro.

`companyId` sale de la sesión o del job, nunca de la entrada del cliente ni de la IA. Fuera de `withTenant`, el rol `pv_app` no ve ninguna fila.

## Comandos

```sh
pnpm db:generate       # genera el cliente (también corre en postinstall)
pnpm db:migrate        # aplica migraciones (MIGRATION_DATABASE_URL)
pnpm db:migrate:dev    # crea una migración nueva en desarrollo
```

Las pruebas de integración usan `TEST_DATABASE_URL` (rol dueño; el nombre de la base debe contener `test`) y crean los usuarios `pv_app_test` y `pv_service_test`.

## Primer superadmin

El superadmin no pertenece a ninguna empresa y no se puede invitar. Se crea una vez por ambiente con las variables de entorno cargadas (usa `SERVICE_DATABASE_URL`); la contraseña se pide por la entrada estándar:

```sh
pnpm admin:create-superadmin admin@ejemplo.com "Nombre"
```

## Semilla de demo

Sobre una base recién migrada y con las variables de entorno cargadas (`NODE_ENV` distinto de `production`; para no depender de la red conviene `WEATHER_PROVIDER=synthetic`):

```sh
pnpm db:seed:demo
```

Crea las empresas "Solar Demo Culiacán" (25 plantas con escenarios) y "Demo Mazatlán" (5 plantas) y un superadmin. Luego ejecuta el pipeline real sobre 90 días: clima, telemetría simulada y métricas diarias. Tarda alrededor de 1.5 min. Las contraseñas se generan al azar y solo se imprimen en la consola. Si la demo ya existe no hace nada; para volver a sembrar hay que recrear la base.

## Respaldos y restauración (F10-T3)

Qué hay que respaldar, porque sin cualquiera de estas cuatro piezas la plataforma no se recupera completa:

| Pieza                 | Dónde vive                      | Cómo se respalda                                                                                                             |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Base de datos         | Render PostgreSQL (`pv-db`)     | Respaldos diarios de Render (`specs/02`), más un respaldo lógico mensual con `pg_dump` guardado fuera de Render              |
| `CREDENTIALS_ENC_KEY` | Variables de Render             | Gestor de contraseñas del equipo, fuera de Render. Sin ella, las credenciales de inversor restauradas no se pueden descifrar |
| Logos y PDFs          | Almacenamiento S3 (`S3_BUCKET`) | Versionado o réplica del bucket, según el proveedor                                                                          |
| Roles de conexión     | Servidor de base de datos       | Se recrean con el SQL de "Roles de base de datos"; los roles `pv_app` y `pv_service` los crea la migración                   |

### Prueba de restauración

`pnpm db:verify-restore` respalda una base, la restaura en una base nueva y verifica que sean equivalentes y seguras:

- filas por tabla idénticas, también las colas;
- mismas migraciones;
- RLS forzado y políticas;
- permisos de `pv_app` y `pv_service`;
- tablas de pg-boss a nombre de `pv_service`;
- aislamiento real: como `pv_app`, sin empresa ve 0 filas, y con una empresa solo las suyas.

```sh
SOURCE_URL=postgres://<rol con BYPASSRLS>@host/pv_iot \
ADMIN_URL=postgres://<dueño>@host/postgres \
TARGET_DB=pv_iot_restore_check \
BACKUP_FILE=./pv-iot-$(date +%F).dump \
pnpm db:verify-restore
```

- `TARGET_DB` debe contener `restore`, para no borrar una base real por error. Se elimina al terminar, salvo con `KEEP_TARGET=1`.
- La conexión de origen debe ser superusuario o tener `BYPASSRLS`. Las tablas de empresa tienen `FORCE ROW LEVEL SECURITY`, así que el dueño también está sujeto a RLS, y `pg_dump` se niega a respaldarlas con ese rol. El script lo revisa antes de empezar.
- Para restaurar en producción a partir de un respaldo lógico, se siguen los mismos pasos que el script hasta "Verificaciones": crear la base, crear los roles, `pg_restore --no-owner` y devolver las tablas de `pgboss` a `pv_service`. Después se crean los usuarios de conexión y se apunta `DATABASE_URL`/`SERVICE_DATABASE_URL` a la base nueva.

Se recomienda repetir la prueba cada trimestre y después de cada cambio de versión de PostgreSQL, y anotar el resultado en `specs/REVISION-FASE-10.md`.

## Colas (pg-boss)

Las colas viven en el esquema `pgboss`, que crea la migración `jobs`. pg-boss se conecta con `SERVICE_DATABASE_URL` como rol `pv_service` (`-c role=pv_service`) e instala ahí sus tablas, a nombre del rol de grupo: se puede rotar el usuario de conexión sin perder las colas. Las colas solo guardan ids y `company_id`.

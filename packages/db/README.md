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

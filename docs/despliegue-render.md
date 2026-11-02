# Despliegue en Render (staging o producción)

Guía para crear un ambiente desde `render.yaml` (tarea F0-T4). Se hace una vez por ambiente; después, cada push a la rama del Blueprint despliega solo.

Servicios que crea el Blueprint:

| Servicio    | Tipo              | Qué es                                                 |
| ----------- | ----------------- | ------------------------------------------------------ |
| `pv-db`     | PostgreSQL 16     | Base de datos                                          |
| `pv-api`    | Web               | API; corre las migraciones antes de cada despliegue    |
| `pv-worker` | Background worker | Jobs: ingesta, clima, métricas, alertas, IA, reportes  |
| `pv-web`    | Web               | Interfaz; reenvía `/api` a `pv-api` por la red privada |

## 0. Tener a la mano antes de empezar

| Dato                                                         | De dónde sale                                                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                          | Consola de Anthropic                                                                                                                                                                  |
| `RESEND_API_KEY` y `EMAIL_FROM`                              | Resend, con el dominio del remitente verificado (por ejemplo `PV-IoT <no-reply@sudominio.mx>`)                                                                                        |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Un bucket de Cloudflare R2 para logos y PDFs: ver "Bucket de almacenamiento" abajo                                                                                                    |
| `CREDENTIALS_ENC_KEY`                                        | Se genera con `openssl rand -base64 32`. **Guárdela en el gestor de contraseñas del equipo antes de seguir**: sin ella, las credenciales de inversor guardadas no se pueden descifrar |
| Dos contraseñas para la base                                 | Se generan con `openssl rand -hex 24` (dos veces): una para `pv_app_login` y otra para `pv_service_login`. En hexadecimal no hace falta escaparlas en la URL                          |

### Bucket de almacenamiento (Cloudflare R2)

El adaptador (`packages/adapters/src/storage/s3.ts`) firma con la región `auto` de R2. AWS S3 necesita una región real y hoy no funcionaría sin un cambio de código.

1. En el panel de Cloudflare, abra **R2 Object Storage** y actívelo. Puede pedir un método de pago aunque el uso quede dentro del nivel gratuito.
2. **Create bucket**:
   - Nombre: `pv-iot-staging` (y otro `pv-iot-produccion` para producción: un bucket por ambiente).
   - Location: _Automatic_, o la sugerencia más cercana a la región de Render (Oregón → Western North America).
   - Déjelo **privado**: sin acceso público ni dominio. La plataforma sirve los logos y los PDFs a través de su API.
3. **Manage R2 API Tokens → Create API token** (uno por bucket):
   - Permisos: **Object Read & Write** (la aplicación solo sube, lee y borra objetos).
   - Alcance: **solo el bucket** de ese ambiente.
   - Sin vencimiento, o con el que dicte la política del equipo.
4. Al crearlo, Cloudflare muestra **una sola vez** el _Access Key ID_ y el _Secret Access Key_. Cópielos al gestor de contraseñas.
5. Copie también el endpoint S3 de su cuenta: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (aparece en la página del bucket y en la del token).

| Variable        | Valor                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `S3_ENDPOINT`   | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (sin el nombre del bucket) |
| `S3_BUCKET`     | `pv-iot-staging`                                                           |
| `S3_ACCESS_KEY` | _Access Key ID_ del token                                                  |
| `S3_SECRET_KEY` | _Secret Access Key_ del token                                              |

No hace falta configurar CORS: el navegador nunca habla directo con el bucket.

Para comprobar las llaves, después del paso 2 corra en la Shell de `pv-api`:

```sh
pnpm storage:check
```

Sube un archivo de prueba, lo lee, lo compara y lo borra. Si falla, muestra el error sin las llaves.

## 1. Crear el Blueprint

En Render: **New → Blueprint**, elija el repositorio y la rama, y deje `render.yaml` como ruta. Render pide las variables marcadas con `sync: false`, una vez para `pv-api` y otra para `pv-worker`. **Use los mismos valores en los dos servicios.**

| Variable                                                    | Valor al crear                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                              | Provisional: `postgres://pendiente:pendiente@localhost:5432/pendiente` (se corrige en el paso 4)                                                                             |
| `SERVICE_DATABASE_URL`                                      | El mismo valor provisional                                                                                                                                                   |
| `APP_URL`                                                   | URL pública de `pv-web`, por ejemplo `https://pv-web.onrender.com`, **sin diagonal al final**. Si Render le asigna otro nombre porque ese ya existe, se corrige en el paso 4 |
| `API_URL`                                                   | El mismo valor que `APP_URL`                                                                                                                                                 |
| `CREDENTIALS_ENC_KEY`                                       | La llave del paso 0                                                                                                                                                          |
| `ANTHROPIC_API_KEY`, `EMAIL_FROM`, `RESEND_API_KEY`, `S3_*` | Los del paso 0                                                                                                                                                               |
| `SIMULATOR_ENABLED`                                         | `true` en staging/demo; `false` en producción                                                                                                                                |

`JWT_SECRET` y `REFRESH_TOKEN_SECRET` los genera Render en el grupo `pv-shared`.

**Si Resend todavía no está listo:** use `EMAIL_FROM=PV-IoT <no-reply@example.com>` y `RESEND_API_KEY=pendiente`. La plataforma arranca, pero ningún correo sale. Crear una empresa o invitar a alguien guarda el registro y responde con error al intentar el envío. Hasta poner la llave real, use solo la demo (paso 5) y el superadmin, y no dé de alta empresas reales. Al tener Resend, cambie las dos variables en `pv-api` y `pv-worker`.

## 2. Primer despliegue (se espera que la API y el worker fallen)

Render crea la base y despliega los servicios.

- En `pv-api`, el paso _pre-deploy_ corre las migraciones con el usuario dueño de la base (`MIGRATION_DATABASE_URL`). En los logs debe aparecer `All migrations have been successfully applied`. Las migraciones también crean los roles de grupo `pv_app` y `pv_service`.
- Después, `pv-api` y `pv-worker` **no arrancan** porque `DATABASE_URL` todavía es provisional. Es lo esperado.
- `pv-web` sí queda arriba.

Si la migración falla con un error de permisos al crear roles, el usuario de Render no puede crear roles: anótelo en `specs/PREGUNTAS.md` (#14) y avise al equipo antes de seguir.

## 3. Crear los usuarios de conexión de la aplicación

En la página de `pv-db`, botón **Connect**, copie el comando `PSQL Command` (conexión externa) y ejecútelo desde una terminal con `psql`. Luego:

```sql
CREATE ROLE pv_app_login LOGIN PASSWORD '<contraseña 1 del paso 0>' IN ROLE pv_app;
CREATE ROLE pv_service_login LOGIN PASSWORD '<contraseña 2 del paso 0>' IN ROLE pv_service;
```

La aplicación se niega a arrancar si se conecta con el usuario dueño o con uno que pueda saltarse RLS (`specs/02`). Por eso usa estos dos usuarios y no la URL que trae Render.

## 4. Apuntar la aplicación a esos usuarios

Copie de `pv-db` la **Internal Database URL**. Tiene la forma `postgres://<usuario>:<contraseña>@<host-interno>/pv_iot`. Cambie usuario y contraseña:

```
DATABASE_URL=postgres://pv_app_login:<contraseña 1>@<host-interno>/pv_iot
SERVICE_DATABASE_URL=postgres://pv_service_login:<contraseña 2>@<host-interno>/pv_iot
```

Guárdelas en **Environment** de `pv-api` y de `pv-worker`. Si la URL real de `pv-web` resultó distinta, corrija también `APP_URL` y `API_URL` en ambos. Render vuelve a desplegar al guardar.

Debe ver:

- `pv-api`: `GET https://<pv-api>/health` responde `{"status":"ok"}`.
- `pv-worker`: en los logs aparece `pv-worker atendiendo jobs`.

## 5. Crear el superadmin

En `pv-api`, pestaña **Shell**:

```sh
pnpm admin:create-superadmin admin@sudominio.mx "Nombre Apellido"
```

La contraseña se pide por la entrada estándar (mínimo 10 caracteres). Entre a `APP_URL` con ese usuario, cree la empresa en **Empresas** e invite a su primer administrador. La invitación llega por correo (Resend).

### Solo staging: datos de demostración

En la Shell de `pv-api`, sobre una base sin datos de demo:

```sh
NODE_ENV=development WEATHER_PROVIDER=synthetic pnpm db:seed:demo
```

Imprime las contraseñas de los usuarios de demo una sola vez; cópielas. **No lo ejecute en producción.**

## 6. Verificación del ambiente

- [ ] Login con el superadmin y con el admin invitado.
- [ ] La invitación y la recuperación de contraseña llegan por correo.
- [ ] Subir el logo de la empresa: se ve en la barra (prueba el bucket S3).
- [ ] **Salud del sistema** (superadmin): `worker.heartbeat` reciente, y `ingest.weather` cada hora.
- [ ] Con la demo: el tablero muestra plantas y alertas; el asistente responde (prueba la llave de Anthropic).
- [ ] En `pv-db`, revisar que los respaldos diarios estén activos según el plan (`specs/02`).

## Problemas comunes

| Síntoma                                                             | Causa probable                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pv-api` sale con `Configuración inválida` y una lista de variables | Falta o sobra algo en las variables; el mensaje dice cuál, sin mostrar el valor       |
| `pv-api` sale con "es superusuario; tiene BYPASSRLS; es dueño de…"  | `DATABASE_URL` usa el usuario dueño de Render en lugar de `pv_app_login`              |
| El navegador no conserva la sesión o hay errores de CORS            | `APP_URL` no coincide exactamente con la URL de `pv-web` (incluida la diagonal final) |
| Logos rotos                                                         | `API_URL` distinta de `APP_URL`, o credenciales del bucket                            |
| Las credenciales de inversor dejaron de descifrarse                 | Cambió `CREDENTIALS_ENC_KEY`; restaure la que se respaldó en el paso 0                |

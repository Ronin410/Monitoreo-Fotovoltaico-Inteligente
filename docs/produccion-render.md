# Ambiente de producción en Render

Cómo crear producción separada de staging (plan de lanzamiento 1.9). Producción se crea con `render.production.yaml` y siguiendo los pasos de `docs/despliegue-render.md`. Esta guía explica solo lo que cambia.

## Por qué separado

|                        | Staging                         | Producción                                              |
| ---------------------- | ------------------------------- | ------------------------------------------------------- |
| Archivo del Blueprint  | `render.yaml`                   | `render.production.yaml`                                |
| Servicios              | `pv-api`, `pv-worker`, `pv-web` | `pv-prod-api`, `pv-prod-worker`, `pv-prod-web`          |
| Base de datos          | `pv-db`                         | `pv-prod-db`, con más espacio                           |
| Rama que despliega     | la de desarrollo                | `main`: solo lo que ya se probó en staging              |
| Simulador y datos demo | sí                              | no (`SIMULATOR_ENABLED` fijo en `false`)                |
| Clima                  | API gratuita de Open-Meteo      | plan comercial (`WEATHER_API_KEY`)                      |
| Mapas                  | OpenStreetMap                   | proveedor comercial (`NEXT_PUBLIC_MAP_TILE_URL`)        |
| Correo                 | dominio de pruebas              | dominio de la empresa, verificado en Resend             |
| Bucket                 | `pv-iot-staging`                | `pv-iot-produccion`, con su propio token                |
| Llaves y contraseñas   | las de staging                  | **todas nuevas**; ninguna se comparte con staging       |
| Personas con acceso    | equipo de desarrollo            | solo quien lo necesita (`docs/respuesta-incidentes.md`) |

Así, un error en una prueba, una llave de staging filtrada o un botón de demo no tocan datos de clientes reales.

## 0. Antes de empezar

1. **Rama `main`.** En GitHub, abra un pull request de la rama probada en staging hacia `main` y fusiónelo. Desde entonces:
   - se trabaja y se prueba en la rama de staging;
   - cuando staging está bien, se abre un pull request hacia `main`, y al fusionarlo producción se despliega sola;
   - en GitHub, **Settings → Branches**, proteja `main`: que pida pull request y que CI pase antes de fusionar.
2. **Dominio.** Decida la dirección pública, por ejemplo `app.sudominio.mx`.
3. **Correo.** En Resend, verifique el dominio de la empresa (registros DNS) y cree una llave nueva solo para producción. `EMAIL_FROM`, por ejemplo `PV-IoT <no-reply@sudominio.mx>`.
4. **Bucket.** En Cloudflare R2, cree `pv-iot-produccion` y un token **solo para ese bucket** (pasos de `docs/despliegue-render.md` §Bucket).
5. **Anthropic.** Cree una llave aparte para producción y póngale un límite de gasto mensual en la consola de Anthropic. Así el consumo de cada ambiente se ve por separado.
6. **Clima.** Contrate el plan comercial de Open-Meteo; la API gratuita es solo para uso no comercial. Su llave va en `WEATHER_API_KEY`.
7. **Mapas.** Cree una cuenta en un proveedor comercial de mapas (por ejemplo MapTiler) y obtenga la URL de los mosaicos con su llave, con `{z}`, `{x}` y `{y}`. Restrinja la llave a su dominio en el panel del proveedor: la URL se ve en el navegador.
8. **Llaves nuevas**, guardadas en el gestor de contraseñas **antes** de seguir:
   - `CREDENTIALS_ENC_KEY`: `openssl rand -base64 32`. Distinta de la de staging.
   - Dos contraseñas para la base: `openssl rand -hex 24`, dos veces.

## 1. Crear el Blueprint

En Render: **New → Blueprint**, elija el repositorio, rama **`main`**, y en **Blueprint Path** escriba `render.production.yaml`.

Llene las variables como en `docs/despliegue-render.md` §1, con los valores de producción. Las nuevas:

| Variable                      | Servicio                         | Valor                                                                   |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `WEATHER_API_KEY`             | `pv-prod-api` y `pv-prod-worker` | La del plan comercial de Open-Meteo                                     |
| `NEXT_PUBLIC_MAP_TILE_URL`    | `pv-prod-web`                    | La URL de mosaicos del proveedor, con su llave                          |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | `pv-prod-web`                    | El texto de atribución que pide el proveedor (en HTML, con sus enlaces) |
| `APP_URL` y `API_URL`         | `pv-prod-api` y `pv-prod-worker` | `https://app.sudominio.mx`, sin diagonal final                          |

`SIMULATOR_ENABLED` no se pide: el archivo lo fija en `false`.

Si todavía no tiene un dominio propio, ponga provisionalmente la URL de `pv-prod-web` en Render (`https://pv-prod-web.onrender.com` o la que le asigne) y cámbiela en el paso 3.

## 2. Pasos 2 a 5 de la guía de staging

Siga `docs/despliegue-render.md` §2 a §5, con los nombres de producción:

- La base es `pv-prod-db` y se llama `pv_iot_prod`: en las URLs del §4, termine con `/pv_iot_prod`.
- Use las contraseñas nuevas del paso 0 al crear `pv_app_login` y `pv_service_login`.
- **Omita "Solo staging: datos de demostración".** En producción no existe el botón "Cargar datos de ejemplo" ni se debe correr `pnpm db:seed:demo`.

## 3. Dominio propio

1. En `pv-prod-web`, **Settings → Custom Domains → Add**: `app.sudominio.mx`. Render indica el registro DNS (CNAME) que hay que crear en su proveedor de dominio y emite el certificado HTTPS solo.
2. Cuando el dominio responda, cambie `APP_URL` y `API_URL` en `pv-prod-api` y `pv-prod-worker` a `https://app.sudominio.mx`. Render vuelve a desplegar.
3. Los enlaces de los correos (invitaciones, recuperar contraseña) usan `APP_URL`: pruebe uno.

## 4. Seguridad del ambiente

- **Acceso a la base desde fuera.** En `pv-prod-db`, **Networking / Access Control**, deje solo las IP de quienes usan pgAdmin. Los servicios de Render se conectan por la red interna y no necesitan estar en la lista.
- **Personas.** Dé acceso a producción solo a quien lo necesita, con verificación en dos pasos en Render, GitHub, Cloudflare, Resend y Anthropic, y anótelas en `docs/respuesta-incidentes.md` §1.
- **Respaldos.** Confirme en `pv-prod-db` que los respaldos están activos en el plan contratado. Al mes de abrir, haga una prueba de restauración (`packages/db/README.md` §Respaldos).
- **Monitoreo externo.** Configure un servicio de monitoreo de disponibilidad que consulte `https://app.sudominio.mx/login` cada pocos minutos y avise por correo o mensaje si no responde (plan 1.10).

## 5. Verificación

- [ ] `pv-prod-api`: `/health` responde `{"status":"ok"}`; `pv-prod-worker` muestra `pv-worker atendiendo jobs`.
- [ ] Login con el superadmin; crear la primera empresa e invitar a su administrador. La invitación llega por correo con el dominio de producción.
- [ ] La persona invitada acepta los términos al crear su contraseña.
- [ ] Subir el logo de la empresa (prueba el bucket). Además, en la Shell de `pv-prod-api`: `pnpm storage:check`.
- [ ] El mapa de plantas usa el proveedor comercial y muestra su atribución.
- [ ] **Salud del sistema**: `worker.heartbeat` reciente e `ingest.weather` cada hora, sin errores de la llave de clima.
- [ ] En **Superadmin → Empresas** no aparece "Cargar datos de ejemplo", y en el alta de plantas no está la marca "Simulador".
- [ ] El asistente de IA responde (prueba la llave de Anthropic de producción).
- [ ] El monitoreo externo avisa: pruébelo pausando `pv-prod-web` un momento fuera de horario.

## 6. Mantenimiento

- **Cambios al Blueprint.** `render.yaml` y `render.production.yaml` deben ir parejos: al agregar una variable o un servicio en uno, agréguelo en el otro.
- **Migraciones.** Se aplican solas antes de cada despliegue. Una migración que falla detiene el despliegue y deja la versión anterior funcionando. Por eso se prueban primero en staging.
- **Volver a una versión anterior.** En el servicio, **Events → Rollback** a un despliegue previo. Ojo: las migraciones no se deshacen solas. Si la versión nueva cambió la base, se corrige con una migración nueva.

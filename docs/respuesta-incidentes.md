# Plan de respuesta a incidentes de seguridad

Qué hacer si se sospecha que alguien accedió sin permiso a datos de PV-IoT, se filtró una llave o contraseña, o se perdieron o alteraron datos (plan de lanzamiento 1.11). Es un **borrador operativo**: los plazos y el texto de los avisos deben revisarse con el abogado, y el contrato de encargo con las instaladoras debe recoger el compromiso de aviso (`docs/cumplimiento-saas.md` §3).

## 1. Personas y contactos

Completar y mantener al día. Debe haber al menos dos personas que puedan actuar, para que una ausencia no detenga la respuesta.

| Papel                                             | Quién    | Teléfono / correo | Acceso a                                                     |
| ------------------------------------------------- | -------- | ----------------- | ------------------------------------------------------------ |
| **Responsable del incidente** (decide y coordina) | [nombre] | [contacto]        | Todo                                                         |
| Respaldo del responsable                          | [nombre] | [contacto]        | Todo                                                         |
| Técnico (contiene y corrige)                      | [nombre] | [contacto]        | Render, base de datos, Cloudflare, Resend, Anthropic, GitHub |
| Abogado (avisos legales)                          | [nombre] | [contacto]        | —                                                            |

**Quién tiene acceso a producción:** llevar en este documento la lista de personas con acceso a Render, a la base, a Cloudflare, a Resend, a Anthropic y a GitHub. Revisarla cada 3 meses y al salir alguien del equipo.

## 2. Niveles de gravedad

| Nivel       | Ejemplos                                                                                                                                      | Tiempo de respuesta                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Crítico** | Datos personales de clientes finales expuestos o copiados; acceso a la base o a `CREDENTIALS_ENC_KEY`; credenciales de inversores descifradas | Empezar de inmediato, a cualquier hora |
| **Alto**    | Llave de un proveedor filtrada (Resend, R2, Anthropic) sin evidencia de uso; cuenta de un usuario tomada por otra persona                     | El mismo día                           |
| **Medio**   | Vulnerabilidad encontrada sin evidencia de que se haya aprovechado; intentos de acceso repetidos y bloqueados                                 | En días hábiles                        |

Si hay duda entre dos niveles, se elige el más alto.

## 3. Pasos

1. **Registrar.** Abrir la bitácora del incidente (§6) con la hora en que se detectó, quién lo reportó y qué se sabe. Todo lo que se haga después se anota con su hora.
2. **Contener** (minutos u horas). Cortar el acceso antes de investigar a fondo; ver §4.
3. **Conservar evidencia.** Antes de borrar o cambiar algo, guardar:
   - `audit_log` y `job_runs` (consultas en §5);
   - los logs de Render de los servicios afectados (el plan contratado los guarda solo unos días; exportarlos);
   - capturas de lo observado.
4. **Evaluar.** Responder estas preguntas:
   - Qué datos, de qué empresas y de cuántos titulares.
   - Desde cuándo y por qué vía.
   - Si se usaron o copiaron.

   El aislamiento entre empresas limita el alcance: una sesión de la empresa A no puede leer datos de la B. Verifique, sin embargo, si el acceso fue directo a la base o a los respaldos.

5. **Avisar** (§7). A las instaladoras afectadas y, con el abogado, a los titulares cuando la ley lo exija.
6. **Corregir y recuperar.** Corregir la causa, desplegar, y si hace falta restaurar datos con el procedimiento de `packages/db/README.md` §Respaldos.
7. **Cerrar con una revisión:** qué pasó, qué funcionó, qué no, y qué se cambia para que no se repita. Si la causa fue el código, se agrega una prueba automática que la detecte.

## 4. Acciones de contención

| Situación                                                  | Qué hacer                                                                                                                                           | Efecto                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Cuenta de un usuario tomada                                | **Configuración → Usuarios → Desactivar** (administrador de la empresa)                                                                             | Sus peticiones se rechazan de inmediato (cada petición revisa el estado) |
| Sesiones de toda una empresa                               | **Superadmin → Empresas → Suspender**                                                                                                               | Revoca todas sus sesiones y detiene sus procesos automáticos             |
| Sesiones de toda la plataforma                             | En Render, cambiar `JWT_SECRET` y `REFRESH_TOKEN_SECRET` del grupo `pv-shared` (valores nuevos de 32 bytes o más) y volver a desplegar `pv-api`     | Todas las personas deben volver a iniciar sesión                         |
| Contraseña de un usuario de la base filtrada               | `ALTER ROLE pv_app_login PASSWORD '<nueva>';` (o `pv_service_login`) y actualizar `DATABASE_URL` / `SERVICE_DATABASE_URL` en `pv-api` y `pv-worker` | Corta las conexiones con la contraseña anterior                          |
| Llave de cifrado de credenciales (`CREDENTIALS_ENC_KEY`)   | Rotarla (§4.1) y pedir a las instaladoras que cambien las contraseñas de sus portales de inversores                                                 | Lo cifrado queda protegido con la llave nueva                            |
| Token de Cloudflare R2, llave de Resend o de Anthropic     | Revocarla en el panel del proveedor, crear una nueva y actualizarla en `pv-api` y `pv-worker`                                                       | La llave anterior deja de funcionar                                      |
| Acceso a GitHub o Render de alguien que ya no debe tenerlo | Quitarle el acceso y revisar los últimos cambios y despliegues                                                                                      | —                                                                        |

### 4.1 Rotar la llave de credenciales de inversores

1. Generar la llave nueva (`openssl rand -base64 32`) y guardarla en el gestor de contraseñas.
2. Cambiar estas variables:
   - en el grupo **pv-shared**, `CREDENTIALS_KEY_VERSION`: la versión anterior + 1;
   - en **pv-api** y **pv-worker**, `CREDENTIALS_ENC_KEY`: la llave nueva;
   - en **pv-api** y **pv-worker**, agregar `CREDENTIALS_PREVIOUS_KEYS` con `<versión anterior>:<llave anterior>` (si hay varias, separadas por comas).

   Desplegar. Lo nuevo ya se cifra con la llave nueva, y lo anterior se sigue leyendo.

3. En la Shell de `pv-api`: `pnpm credentials:rotate`. Vuelve a cifrar todo, también lo de empresas suspendidas, e informa cuántas credenciales cambió. Si dice que falta una llave, agréguela a `CREDENTIALS_PREVIOUS_KEYS` y vuelva a correrlo.
4. Quitar `CREDENTIALS_PREVIOUS_KEYS` y desplegar. La llave anterior ya no sirve para nada.
5. Si la llave se filtró, además pedir a las instaladoras que cambien las contraseñas de los portales de sus inversores, porque alguien pudo haberlas descifrado antes de la rotación.

## 5. Consultas útiles (con `pv_service_login`)

```sql
-- Inicios de sesión fallidos recientes (posible ataque de contraseñas)
SELECT created_at, ip, metadata FROM audit_log
WHERE action = 'auth.login_failed' AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

-- Acciones de un usuario
SELECT created_at, action, entity_type, entity_id, ip, metadata FROM audit_log
WHERE user_id = '<id>' ORDER BY created_at DESC LIMIT 200;

-- Cambios de credenciales, usuarios y reportes enviados en un periodo
SELECT created_at, company_id, user_id, action, ip FROM audit_log
WHERE action IN ('plant.credentials_updated', 'user.updated', 'user.invited', 'report.sent')
  AND created_at BETWEEN '<desde>' AND '<hasta>'
ORDER BY created_at;
```

## 6. Bitácora del incidente (plantilla)

```
Incidente: [número] · Nivel: [crítico/alto/medio] · Responsable: [nombre]
Detectado: [fecha y hora] por [quién/cómo]
Qué se sabe: …
Línea de tiempo:
  [hora] …
Datos y empresas afectados: …
Contención: …
Avisos enviados: [a quién, cuándo, por qué medio]
Causa: …
Corrección: …
Qué cambiamos para que no se repita: …
Cerrado: [fecha]
```

## 7. Avisos

- **A las instaladoras afectadas** (son las responsables de los datos de sus clientes): avisar por correo y por teléfono en cuanto se confirme que sus datos se vieron comprometidos. Compromiso propuesto para el contrato de encargo: **dentro de las 72 horas** siguientes a confirmarlo. El aviso dice qué pasó, qué datos, qué se hizo y qué les recomendamos.
- **A los titulares** (clientes finales y usuarios): la ley obliga al responsable a informarles sin demora cuando la vulneración afecta de forma significativa sus derechos. Con el abogado, acordar quién avisa (normalmente la instaladora, con apoyo de PV-IoT) y confirmar los plazos y el contenido vigentes.
- **A las autoridades:** si corresponde, según indique el abogado.

Texto base para las instaladoras:

> Asunto: Aviso de incidente de seguridad en PV-IoT
>
> El [fecha] detectamos [descripción breve]. Afectó [qué datos] de [cuántos] clientes de su empresa. Ya [medidas tomadas]. Le recomendamos [acciones, por ejemplo cambiar la contraseña del portal de inversores]. Le mantendremos informado; contacto: [nombre, teléfono, correo].

## 8. Prácticas preventivas

- Acceso a producción solo para quien lo necesita, con verificación en dos pasos en Render, GitHub, Cloudflare, Resend y Anthropic.
- Revisar cada 3 meses la lista de accesos (§1) y probar la restauración de respaldos (`pnpm db:verify-restore`).
- Revisar cada semana el panel **Salud del sistema** y las alertas del monitoreo externo de disponibilidad.
- Rotar las llaves de los proveedores al menos una vez al año, y siempre que alguien con acceso deje el equipo.

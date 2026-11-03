# Plan de lanzamiento de PV-IoT como SaaS

Plan unificado (2026-11-03) a partir de la revisión de cumplimiento (`docs/cumplimiento-saas.md`) y de una lista de pendientes comerciales. Se marca cada punto al terminarlo, con la fecha.

**Simbología del estado:**

- ✅ hecho
- 🟡 en curso o parcial
- ⬜ pendiente

**Responsables:**

- **Equipo:** decisiones y gestiones del negocio.
- **Código:** se programa en este repositorio.
- **Abogado** y **Contador:** especialistas externos.

**Ambientes:**

- **Staging** es el ambiente de pruebas y demos: tiene el simulador y los datos de ejemplo, y usa servicios gratuitos (mapas de OpenStreetMap, API gratuita de Open-Meteo).
- **Producción** es otro Blueprint de Render (`render.production.yaml`, guía en `docs/produccion-render.md`), desplegado desde `main`, sin simulador y con servicios comerciales. Cambiar de uno a otro es solo cuestión de variables de entorno (ver §2).

## 0. Bloqueo principal: leer inversores reales

| #   | Tarea                                                                                                                                                                                                           | Responsable | Estado |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | :----: |
| 0.1 | Elegir la primera marca (la que más usen los clientes piloto): GoodWe, Growatt o Victron                                                                                                                        | Equipo      |   ⬜   |
| 0.2 | Conseguir su **documentación oficial de API** (✅ Victron y GoodWe, `docs/fabricantes/`), una cuenta de prueba con un inversor reportando y la confirmación escrita de que permite uso comercial por un tercero | Equipo      |   🟡   |
| 0.3 | Programar el adaptador con esa documentación (GoodWe y Victron: credenciales y prueba de conexión listas; falta la lectura de datos, que necesita una cuenta real) y repetir la prueba de carga (F10-T6)        | Código      |   🟡   |

Sin esto, un piloto solo muestra datos simulados.

## 1. Técnico y seguridad

| #    | Tarea                                                                                                                                                                       | Responsable      | Estado |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | :----: |
| 1.1  | Aislamiento entre empresas en dos capas, con prueba que recorre todas las rutas                                                                                             | Código           |   ✅   |
| 1.2  | Credenciales cifradas (AES-256-GCM), contraseñas argon2id, sesiones revocables                                                                                              | Código           |   ✅   |
| 1.3  | La IA nunca recibe teléfonos, correos, domicilios ni credenciales                                                                                                           | Código           |   ✅   |
| 1.4  | Escaneo de secretos y dependencias en CI; auditoría de acciones sensibles                                                                                                   | Código           |   ✅   |
| 1.5  | Respaldos: confirmar los de Render en el plan contratado y repetir la prueba de restauración en staging (F10-T3)                                                            | Equipo + Código  |   🟡   |
| 1.6  | Mapas configurables: OpenStreetMap gratuito en staging, proveedor comercial en producción                                                                                   | Código           |   ✅   |
| 1.7  | Clima: API gratuita de Open-Meteo en staging; plan comercial y `WEATHER_API_KEY` en producción                                                                              | Equipo           |   🟡   |
| 1.8  | Decidir sobre la licencia de `react-leaflet` (validarla o reemplazarla por Leaflet directo)                                                                                 | Abogado + Código |   ⬜   |
| 1.9  | Ambiente de **producción** separado (otro Blueprint, desde `main`, `SIMULATOR_ENABLED=false`): `render.production.yaml` y `docs/produccion-render.md` listos; falta crearlo | Equipo + Código  |   🟡   |
| 1.10 | Monitoreo externo de disponibilidad (aviso si la plataforma se cae) y página de estado                                                                                      | Equipo           |   ⬜   |
| 1.11 | Plan de respuesta a incidentes y política de seguridad escrita (accesos a producción)                                                                                       | Equipo + Código  |   🟡   |
| 1.12 | Prueba de penetración externa y corrección de hallazgos                                                                                                                     | Externo          |   ⬜   |

## 2. Variables de entorno: staging contra producción

| Variable                        | Staging (pruebas)                   | Producción                                                       |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `SIMULATOR_ENABLED`             | `true`                              | `false`                                                          |
| `WEATHER_API_KEY`               | vacía (API gratuita de Open-Meteo)  | llave del plan comercial                                         |
| `NEXT_PUBLIC_MAP_TILE_URL`      | vacía (OpenStreetMap)               | URL del proveedor comercial (por ejemplo, MapTiler con su llave) |
| `NEXT_PUBLIC_MAP_ATTRIBUTION`   | vacía (atribución de OpenStreetMap) | la que pida el proveedor                                         |
| `EMAIL_FROM` / `RESEND_API_KEY` | dominio verificado de pruebas       | dominio verificado de producción                                 |
| `S3_BUCKET`                     | `pv-iot-staging`                    | `pv-iot-produccion`                                              |

## 3. Legal y documentos

| #    | Tarea                                                                                                                                                        | Responsable      |   Estado    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | :---------: |
| 3.1  | Aviso de privacidad final (ley de 2025), con razón social, domicilio y correo de privacidad                                                                  | Abogado          | 🟡 borrador |
| 3.2  | Términos de uso (personas) y contrato SaaS (empresa instaladora)                                                                                             | Abogado          | 🟡 borrador |
| 3.3  | **Contrato de encargo** (DPA) con cada instaladora                                                                                                           | Abogado          |     ⬜      |
| 3.4  | Plantilla de aviso de privacidad para que las instaladoras informen a sus clientes                                                                           | Abogado          |     ⬜      |
| 3.5  | Registrar la **aceptación de los términos** por persona (versión, fecha, IP)                                                                                 | Código           |     ✅      |
| 3.6  | Aceptar los DPA de Render, Cloudflare, Resend y Anthropic, y publicar la lista de subencargados                                                              | Equipo           |     ⬜      |
| 3.7  | **Exportar** los datos de una empresa y **borrado definitivo** al terminar el contrato (`docs/cumplimiento-saas.md` §10.1)                                   | Código           |     ✅      |
| 3.8  | Nivel de servicio: empezar con un **objetivo** de disponibilidad sin penalizaciones; prometer un 99.5 % con compensación solo con infraestructura redundante | Equipo + Abogado |     ⬜      |
| 3.9  | Acuerdo de piloto por escrito (gratuito, tiempo limitado, incluye el contrato de encargo)                                                                    | Abogado          |     ⬜      |
| 3.10 | Registro de la marca "PV-IoT" en el IMPI                                                                                                                     | Abogado          |     ⬜      |

## 4. Fiscal y cobro

| #   | Tarea                                                                                                     | Responsable | Estado |
| --- | --------------------------------------------------------------------------------------------------------- | ----------- | :----: |
| 4.1 | Quién factura (persona moral o física), RFC, régimen e IVA                                                | Contador    |   ⬜   |
| 4.2 | Facturación CFDI 4.0 con un proveedor de facturación (PAC)                                                | Contador    |   ⬜   |
| 4.3 | Primeros clientes: facturar a mano y cobrar por transferencia (SPEI)                                      | Equipo      |   ⬜   |
| 4.4 | Con 10 o más clientes: pasarela de pago recurrente (Stripe, Openpay o Conekta) conectada a la facturación | Código      |   ⬜   |

## 5. Modelo comercial

| #   | Tarea                                                                                                                                                                                                                 | Responsable     | Estado |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | :----: |
| 5.1 | Costo mensual por empresa: Render, tokens de IA, clima, mapas y correo, con el consumo medido en staging: `pnpm costs:report` y `docs/costos.md` listos; falta llenar precios y medir                                 | Equipo + Código |   🟡   |
| 5.2 | Precio por número de plantas (o por kW gestionados), mensual y anual                                                                                                                                                  | Equipo          |   ⬜   |
| 5.3 | Planes: **Básico** (monitoreo, alertas con explicación) y **Pro** (más asistente IA y reportes mensuales automáticos). Hoy el campo "plan" es solo texto: hay que programar qué habilita cada plan, con su spec antes | Equipo + Código |   ⬜   |

## 6. Lanzamiento y clientes

| #   | Tarea                                                                                                                             | Responsable     | Estado |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | :----: |
| 6.1 | Demos en **staging** con "Cargar datos de ejemplo" (no existe en producción, a propósito)                                         | Equipo          |   ✅   |
| 6.2 | Resend con dominio verificado (alertas, invitaciones, reportes)                                                                   | Equipo          |   🟡   |
| 6.3 | Evaluación del asistente con la llave real de Anthropic (`pnpm eval:assistant`)                                                   | Equipo + Código |   ⬜   |
| 6.4 | **Importación masiva** de clientes y plantas (CSV), indispensable para instaladoras con muchas plantas                            | Código          |   ✅   |
| 6.5 | Proceso de alta de un cliente nuevo: quién captura las plantas y las credenciales, y en cuánto tiempo                             | Equipo          |   ⬜   |
| 6.6 | Piloto con 1 o 2 instaladoras de la región, durante un mes, a cambio de retroalimentación                                         | Equipo          |   ⬜   |
| 6.7 | Página comercial con beneficios y enlaces al aviso de privacidad y a los términos, sin mencionar certificaciones que no se tengan | Equipo          |   ⬜   |
| 6.8 | Canal y horario de soporte                                                                                                        | Equipo          |   ⬜   |

## Orden recomendado

1. **§0**, el adaptador real de inversores: es lo que más bloquea.
2. Producción separada (1.9), Resend verificado (6.2), y mapas y clima comerciales en producción (1.6, 1.7).
3. Documentos con el abogado y el contador (§3, 4.1, 4.2).
4. Piloto (6.6) con la importación masiva (6.4).
5. Precios con el costo real, planes y pasarela de pago (§5, 4.4).
6. Prueba de penetración y, si los clientes lo piden, certificaciones (ver `docs/cumplimiento-saas.md` §9).

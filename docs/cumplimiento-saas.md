# Cumplimiento para comercializar PV-IoT como SaaS (México)

Revisión preparada el 2026-11-03 para conversar con un abogado y un contador. **No es asesoría legal ni fiscal:** resume las obligaciones que aplican a un SaaS B2B en México, qué cumple hoy la plataforma y qué falta. Las leyes cambian; confirme cada punto con un especialista.

**Simbología:**

- ✅ cumple
- ⚠️ parcial o hay que confirmar
- ❌ falta

## 1. Resumen

- **No existe una certificación obligatoria** para vender un software de monitoreo como servicio en México. Ninguna entidad externa tiene que auditar ni "aprobar" la plataforma antes de venderla.
- **Sí hay obligaciones de ley.** La más importante es la de **datos personales**: la plataforma guarda nombre, teléfono, correo y domicilio de los clientes finales de cada instaladora. Las demás son de **contratos y comercio electrónico**, **fiscales** y de **licencias de servicios y software de terceros**.
- **Las certificaciones voluntarias** (ISO/IEC 27001, SOC 2) y una **prueba de penetración externa** no son obligatorias. Las piden los clientes grandes y dan confianza; conviene planearlas, no son requisito para empezar.
- **Técnicamente la plataforma está bien encaminada:** aislamiento entre empresas, cifrado, auditoría, respaldos, retención y minimización de datos a la IA. **Lo que falta es sobre todo documental y contractual**, más tres ajustes técnicos: exportar y borrar datos, el proveedor de mapas y el plan comercial de clima.

## 2. Quién es quién en los datos personales

| Papel             | Quién                                                                                                                | Qué implica                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsable**   | Cada empresa instaladora                                                                                             | Decide para qué usa los datos de sus clientes. Debe tener **su propio aviso de privacidad** y atender los derechos de sus clientes.                                                               |
| **Encargado**     | PV-IoT (su empresa)                                                                                                  | Trata los datos **por cuenta** de la instaladora. Necesita un **contrato de encargo** con cada instaladora y medidas de seguridad. Es responsable directo de los datos de las cuentas de usuario. |
| **Subencargados** | Render (servidores), Cloudflare R2 (archivos), Resend (correo), Anthropic (IA), Open-Meteo (clima, solo coordenadas) | Proveedores de PV-IoT. Requieren contrato y que se puedan listar a los clientes. Están en EE.UU. u otros países.                                                                                  |

## 3. Datos personales — Ley Federal de Protección de Datos Personales en Posesión de los Particulares

La **ley vigente se publicó en el DOF el 20 de marzo de 2025** y entró en vigor el 21 de marzo de 2025 (su última reforma publicada es del 14 de noviembre de 2025).

- **Autoridad:** el INAI desapareció y sus funciones sobre datos en posesión de particulares pasaron a la **Secretaría Anticorrupción y Buen Gobierno**.
- **Cambio relevante:** el aviso de privacidad ya no tiene que informar las transferencias a terceros.
- **Pendiente de confirmar** con el abogado si ya existe un reglamento nuevo y qué lineamientos siguen vigentes.

| Obligación                                                          |              Estado              | Detalle / qué hacer                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | :------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aviso de privacidad de PV-IoT (cuentas de usuario y como encargado) |                ⚠️                | Existe en `/privacidad` como **borrador**. El abogado debe ajustarlo a la ley de 2025 y completar razón social, domicilio y correo de privacidad.                                                                                                                                                                     |
| Aviso de privacidad de cada instaladora para sus clientes finales   |                ❌                | Es obligación de la instaladora. Conviene darles una **plantilla** que mencione el uso de PV-IoT.                                                                                                                                                                                                                     |
| Contrato de encargo (DPA) con cada instaladora                      |                ❌                | Que PV-IoT solo usa los datos para dar el servicio, confidencialidad, medidas de seguridad, subencargados, aviso de vulneraciones, y devolución o borrado al terminar.                                                                                                                                                |
| Medidas de seguridad administrativas, técnicas y físicas            | ✅ técnicas / ❌ administrativas | **Técnicas, ya hechas:** aislamiento entre empresas en dos capas, credenciales de inversor cifradas, contraseñas argon2id, sesiones revocables, auditoría, escaneo de secretos y dependencias, respaldos. **Administrativas, faltan:** política de seguridad escrita, quién tiene acceso a producción y capacitación. |
| Minimización (no tratar más de lo necesario)                        |                ✅                | La IA nunca recibe teléfonos, correos, domicilios ni credenciales. El superadmin no ve datos operativos.                                                                                                                                                                                                              |
| Conservación y borrado                                              |                ⚠️                | La telemetría se guarda 13 meses. Falta definir plazos para lo demás y **qué pasa cuando una instaladora deja el servicio**.                                                                                                                                                                                          |
| Derechos ARCO (acceso, rectificación, cancelación, oposición)       |                ⚠️                | Hoy se rectifica editando al cliente y se cancela eliminándolo (borrado lógico). Faltan: **exportar** los datos de un cliente o de una empresa completa, el **borrado definitivo**, y un procedimiento escrito con plazos.                                                                                            |
| Vulneraciones de seguridad (brechas)                                |                ❌                | Falta un **plan de respuesta a incidentes**: cómo se detecta, a quién se avisa (instaladoras y titulares) y en cuánto tiempo, y bitácora.                                                                                                                                                                             |
| Subencargados y servidores fuera de México                          |                ⚠️                | Aceptar los contratos de tratamiento de datos (DPA) que ofrecen Render, Cloudflare, Resend y Anthropic. Publicar la lista de subencargados. Mencionarlo en el contrato con las instaladoras.                                                                                                                          |
| Prueba de que se aceptaron términos y aviso                         |                ❌                | Hoy solo se muestra la leyenda al crear la cuenta. Conviene **guardar versión, fecha e IP** de la aceptación (`specs/PREGUNTAS.md` #199).                                                                                                                                                                             |

## 4. Contratos y comercio electrónico

| Tema                               | Estado  | Detalle                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | :-----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Términos de uso / contrato SaaS    |   ⚠️    | Borrador en `/terminos`. Falta completarlo y revisarlo con el abogado: precio y forma de pago, vigencia y cancelación, límites de responsabilidad (las estimaciones de ahorro y la IA son orientativas), propiedad de los datos, exportación al terminar, ley aplicable y tribunales.         |
| Nivel de servicio (SLA) y soporte  |   ❌    | Definir disponibilidad comprometida, horario de soporte y tiempos de respuesta. Lo piden los clientes y protege a PV-IoT.                                                                                                                                                                     |
| Contratos electrónicos             | ✅ / ⚠️ | El Código de Comercio reconoce los contratos por medios electrónicos. Para conservar la evidencia con mayor valor existe la **NOM-151-SCFI-2016** (constancias de conservación de un prestador de servicios de certificación). Es **opcional**; útil si se firman contratos grandes en línea. |
| Protección al consumidor (PROFECO) |   ⚠️    | Si se vende solo a empresas (B2B), en general no aplica la ley al consumidor. Si alguna vez se vende a personas físicas como consumidores finales, revisarlo con el abogado.                                                                                                                  |

## 5. Fiscal y corporativo

| Tema                                                  | Estado | Detalle                                                                                                                                                                                           |
| ----------------------------------------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona moral o física con actividad empresarial, RFC |   ❌   | Define quién factura. Lo resuelve el contador.                                                                                                                                                    |
| Facturación electrónica (CFDI 4.0)                    |   ❌   | Cada cobro necesita su CFDI con el RFC del cliente, por medio de un proveedor de facturación (PAC). La plataforma no factura; la facturación integrada está en el roadmap (`specs/13`, punto 10). |
| IVA                                                   |   ❌   | El servicio causa IVA al 16 %. Confirmar con el contador el tratamiento.                                                                                                                          |
| Marca "PV-IoT"                                        |   ❌   | Buscar disponibilidad y **registrarla en el IMPI** antes de invertir en mercadotecnia.                                                                                                            |

## 6. Servicios y software de terceros

| Tema                                       | Estado  | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | :-----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licencias de las librerías                 | ✅ / ⚠️ | Revisadas el 2026-11-03: 550 de producción, casi todas MIT, Apache-2.0, ISC o BSD (uso comercial permitido). **Revisar:** `react-leaflet` usa la _Hippocratic License 2.1_, una licencia "ética" no estándar que agrega condiciones de derechos humanos; el abogado debe validarla o se reemplaza por Leaflet directo (BSD). La LGPL de `libvips` (imágenes de Next.js) y la EPL de `elkjs` no causan problema en un SaaS. |
| Mapas (OpenStreetMap)                      |   ❌    | Los mapas cargan mosaicos de `tile.openstreetmap.org`. Su política de uso no permite uso comercial intensivo y no da garantía. **Cambiar a un proveedor comercial** de mosaicos (por ejemplo MapTiler o Stadia Maps), conservando la atribución.                                                                                                                                                                           |
| Clima (Open-Meteo)                         |   ⚠️    | La API gratuita de Open-Meteo es para uso no comercial. **El adaptador ya soporta su API comercial** (`WEATHER_API_KEY`); falta contratar el plan y poner la llave en producción.                                                                                                                                                                                                                                          |
| APIs de fabricantes de inversores          |   ⚠️    | Al pedir la documentación de GoodWe, Growatt y Victron, confirmar por escrito que sus términos **permiten que un tercero (PV-IoT) consulte datos con fines comerciales** en nombre de la instaladora.                                                                                                                                                                                                                      |
| IA (Anthropic)                             | ✅ / ⚠️ | La API comercial permite este uso. Revisar su política de uso aceptable y aceptar su DPA. Los términos de PV-IoT ya dicen que las explicaciones de la IA son orientativas.                                                                                                                                                                                                                                                 |
| Correo (Resend) y archivos (Cloudflare R2) |   ⚠️    | Planes de pago con DPA aceptado. Verificar el dominio del remitente (SPF y DKIM) para que los correos no caigan en spam.                                                                                                                                                                                                                                                                                                   |

## 7. Inteligencia artificial

Según las fuentes consultadas (hasta julio de 2026), **México no tiene una ley general de IA aprobada**. Hay muchas iniciativas en el Congreso y se esperaba discutirlas a partir de septiembre de 2026. Por ahora aplican las reglas generales: datos personales, consumidor y propiedad intelectual. La plataforma ya tiene buenas prácticas que probablemente pida una ley futura:

- dice cuándo un texto lo escribió la IA;
- tiene textos de respaldo si la IA falla;
- la IA no recibe datos de contacto;
- la IA no ejecuta SQL libre;
- hay límites de uso y presupuesto.

**Acción:** revisar cada seis meses el avance legislativo.

## 8. Sector energía

El monitoreo **no genera ni vende electricidad**: es software de análisis. Según lo revisado, no requiere permiso de la CRE ni del CENACE, y las NOM eléctricas aplican a los equipos (inversores, paneles), no al software. **Confirmarlo con el abogado**, sobre todo si en el futuro la plataforma **controla** equipos (por ejemplo, apagarlos a distancia) en lugar de solo leerlos.

## 9. Certificaciones voluntarias (cuándo valen la pena)

| Opción                            | Qué es                                                                                                          | Cuándo                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prueba de penetración externa** | Una empresa de seguridad intenta vulnerar la plataforma y entrega un reporte.                                   | **Recomendado antes de cobrar al primer cliente** o en los primeros meses. Costo moderado, gran valor: es lo primero que piden los clientes serios. |
| **ISO/IEC 27001**                 | Certifica el sistema de gestión de seguridad de la información. Lo audita un organismo certificador acreditado. | Cuando lleguen clientes corporativos que lo exijan. Toma de 6 a 12 meses de preparación.                                                            |
| **ISO/IEC 27701**                 | Extensión de la 27001 para privacidad.                                                                          | Junto con la 27001, si los datos personales son argumento de venta.                                                                                 |
| **SOC 2 Tipo II**                 | Informe de auditoría estándar en EE.UU.                                                                         | Solo si se vende a empresas de EE.UU.                                                                                                               |

Los proveedores principales (Render, Cloudflare, Anthropic) publican sus propias certificaciones de seguridad. Conviene guardarlas como evidencia; confírmelas en sus páginas de seguridad.

## 10. Plan de acción

**Antes del primer cliente de pago**

1. Constituir la empresa o definir quién factura, y obtener RFC, CFDI 4.0 y régimen de IVA (contador).
2. Con el abogado:
   - aviso de privacidad final (ley de 2025);
   - términos de uso / contrato SaaS;
   - contrato de encargo (DPA);
   - plantilla de aviso de privacidad para las instaladoras.
3. Aceptar los DPA de Render, Cloudflare, Resend y Anthropic, y publicar la lista de subencargados.
4. Contratar el plan comercial de Open-Meteo y cambiar el proveedor de mapas (ajuste técnico pequeño).
5. Confirmar con los fabricantes de inversores el uso comercial de sus APIs.
6. Decidir sobre `react-leaflet` (validar la licencia o reemplazarla).
7. Buscar y registrar la marca en el IMPI.

**Primeros 3 a 6 meses**

8. Plan de respuesta a incidentes y política de seguridad escrita, incluido el control de accesos a producción.
9. Funciones de **exportar datos** (cliente y empresa) y **borrado definitivo** al terminar el contrato; **registro de aceptación** de términos con versión y fecha.
10. Definir SLA y soporte, y publicar una página de estado.
11. Prueba de penetración externa y corrección de hallazgos.
12. Repetir en staging la prueba de restauración de respaldos (pendiente F10-T3).

**Cuando crezca**

13. ISO/IEC 27001 (y 27701) si los clientes lo piden; SOC 2 si se vende en EE.UU.

## 11. Preguntas para el abogado y el contador

- ¿El aviso de privacidad y el contrato de encargo cumplen la ley de 2025? ¿Ya hay reglamento nuevo o lineamientos de la Secretaría Anticorrupción y Buen Gobierno?
- ¿Cómo documentar que los servidores y proveedores están fuera de México?
- ¿Qué plazos y forma de aviso deben tener las vulneraciones de seguridad?
- ¿La _Hippocratic License_ de `react-leaflet` es aceptable para un uso comercial?
- ¿Conviene conservar la aceptación de los contratos con NOM-151?
- ¿Qué régimen fiscal e IVA aplica a la suscripción? ¿Se cobra en pesos o dólares?
- ¿Algún aspecto regulatorio del sector energía si en el futuro se controlan equipos a distancia?

## Fuentes

- [Ley Federal de Protección de Datos Personales en Posesión de los Particulares (Cámara de Diputados, texto vigente)](http://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)
- [Reformas a la ley (Cámara de Diputados)](https://www.diputados.gob.mx/LeyesBiblio/ref/lfpdppp.htm)
- [EY — Entrada en vigor de la nueva LFPDPPP](https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares)
- [Santos Elizondo — Nueva LFPDPPP](https://www.santoselizondo.com/en/nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares/)
- [Secretaría de Economía — NOM-151-SCFI-2016](https://platiica.economia.gob.mx/normalizacion/nom-151-scfi-2016/)
- [SAT, criterio 4/IVA/N (servicios digitales)](https://sdv.com.mx/compendio/criterios-normativos-sat/criterio-4-iva-n/)
- [Tungsten — CFDI 4.0 obligatorio desde abril de 2023](https://www.tungstenautomation.com/compliance-overview/country-updates/country/mexico/upcoming-cfdi-4-0-obligations)
- [Garrigues — Mapa regulatorio de la IA en México](https://www.garrigues.com/es_ES/noticia/mapa-regulatorio-inteligencia-artificial-mexico)
- [ITSitio — Regulación de IA en México: todavía no hay ley general](https://www.itsitio.com/mx/?p=195729)
- [Expansión — México y la regulación de la IA (julio de 2026)](https://expansion.mx/empresas/2026/07/13/mexico-regulacion-inteligencia-artificial-tmec)

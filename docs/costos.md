# Hoja de costos por empresa

Cuánto cuesta dar servicio a cada instaladora al mes, con el consumo medido en la plataforma (plan de lanzamiento 5.1). Sirve para fijar precios (5.2) y planes (5.3).

## 1. Qué se mide

El comando `pnpm costs:report` cuenta, por empresa, sin leer datos de clientes:

| Concepto      | Cómo se mide                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Plantas       | Plantas no eliminadas                                                                                |
| Lecturas/día  | Lecturas de 15 min guardadas en los últimos N días (por defecto 30), entre N                         |
| Tokens de IA  | `ai_usage_monthly` del mes elegido (por defecto el mes pasado), por función                          |
| Correos/mes   | Correos enviados en la ventana (alertas, resúmenes diarios y reportes), llevados a 30 días           |
| Archivos      | PDFs de reportes × tamaño promedio (`--pdf-kb`, 150 KB por defecto) + la última exportación de datos |
| Base de datos | Tamaño total de la base (para todas las empresas)                                                    |

Cada función de IA usa un modelo:

- el **chat** del asistente usa `LLM_MODEL_CHAT`;
- las **explicaciones de alertas** y los **textos de los reportes** usan `LLM_MODEL_FAST`.

No se cuentan los correos de invitación ni de recuperación de contraseña, que son pocos.

## 2. Cómo correrlo

En la **Shell** de `pv-api` (staging o producción):

```sh
pnpm costs:report                      # solo consumo
pnpm costs:report --prices docs/costos-precios.json
pnpm costs:report --period 2026-10 --days 30 --json
```

Para el costo en dólares:

1. Copie `docs/costos-precios.example.json` a `docs/costos-precios.json`.
2. Llene los precios del §3 y confírmelo en el repositorio. Los precios no son secretos.
3. Despliegue y córralo con `--prices`. Si queda algún costo fijo en 0, el reporte lo avisa.

Mídalo en staging después de al menos un mes con datos de ejemplo cargados y uso real del asistente. Repítalo en producción con el piloto: el consumo de IA depende de cuánto pregunten las personas.

## 3. Precios a llenar

Revise cada precio en la página oficial del proveedor el día que arme la hoja, y anote la fecha en `reviewed_at`. Los de IA ya vienen llenos en el ejemplo, los demás en 0.

| Concepto (`campo`)                                   | Dónde se consulta                                 | Nota                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `claude-sonnet-5-5` (chat)                           | Página de precios de la API de Anthropic          | Al 2026-10-06: 2 USD por millón de tokens de entrada y 10 de salida                                                   |
| `claude-haiku-5-5` (alertas y reportes)              | Ídem                                              | Al 2026-10-06: 0.10 y 0.50 USD por millón, para prompts de hasta 100K tokens (los de la plataforma son mucho menores) |
| `render_pv_api`, `render_pv_worker`, `render_pv_web` | Precios de Render, según el plan de cada servicio | Hoy `starter` en `render.yaml`                                                                                        |
| `render_pv_db`                                       | Ídem, plan de PostgreSQL                          | Staging `basic-256mb`, producción `basic-1gb`                                                                         |
| `open_meteo_comercial`                               | Precios de Open-Meteo (API comercial)             | En staging es 0: API gratuita                                                                                         |
| `mapas_comerciales`                                  | Precios de MapTiler u otro proveedor              | En staging es 0: OpenStreetMap                                                                                        |
| `resend_plan` y `email_per_1000`                     | Precios de Resend                                 | Cuota fija del plan y costo por correo extra                                                                          |
| `storage_per_gb_month`                               | Precios de Cloudflare R2                          | R2 tiene una capa gratuita; con pocos GB el costo es casi 0                                                           |
| `dominio_y_otros`                                    | —                                                 | Dominio, monitoreo externo y otros fijos                                                                              |

## 4. Fórmula

Por empresa, en USD al mes:

```
IA        = Σ por función (tokens de entrada × precio de entrada + tokens de salida × precio de salida) / 1,000,000
Correos   = correos/mes / 1,000 × email_per_1000
Archivos  = GB guardados × storage_per_gb_month
Fijos     = (suma de fixed_monthly) × plantas de la empresa / plantas de toda la plataforma
Total     = IA + Correos + Archivos + Fijos
Por planta = Total / plantas
```

Está en `packages/core/src/costs.ts` (`companyMonthlyCost`), con sus pruebas. Los costos fijos se reparten por plantas porque la carga de la base y del worker crece con ellas.

## 5. Cómo usarlo para fijar precios

- **Costo por planta** = fijos / plantas totales + variable de la empresa / sus plantas. Los fijos por planta bajan conforme entran más empresas; el variable (sobre todo la IA) no.
- El **precio por planta** debe cubrir el costo por planta con margen, más soporte y ventas, que no están en esta hoja.
- Un **precio mínimo** por empresa cubre a las instaladoras con pocas plantas pero mucho uso del asistente.
- El **plan Pro** (asistente y reportes automáticos) concentra el costo de IA. Compare el uso de IA de las empresas que lo usan con el de las que no. El presupuesto mensual de tokens (`ai_monthly_token_budget`) es el tope que protege el margen.
- **Crecimiento de la base:** las lecturas se guardan 13 meses. Lecturas/día × 395 da las filas de una empresa en régimen; con el tamaño de la base y el total de lecturas se estima cuánto ocupa cada fila y cuándo hay que subir el plan de PostgreSQL.

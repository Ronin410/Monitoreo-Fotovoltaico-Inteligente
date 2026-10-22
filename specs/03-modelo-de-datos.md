# 03 — Modelo de datos

Convenciones: PK `id uuid` (v7 o v4), timestamps `timestamptz` en UTC, `created_at` y `updated_at` en todas las tablas. Nombres en `snake_case`. **Toda tabla marcada con 🔒 tiene `company_id uuid NOT NULL` con RLS.**

## Plataforma

### `companies`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid | |
| name | text | |
| slug | text unique | |
| logo_url | text null | |
| brand_color | text | hex, por defecto `#F59E0B` |
| timezone | text | por defecto `America/Mazatlan` |
| status | enum `active`, `suspended` | suspendida = no puede iniciar sesión, los jobs se pausan |
| plan | text | informativo en v1 |
| settings | jsonb | ver estructura abajo |
| ai_monthly_token_budget | int | por defecto 2 000 000 |

`settings` (validado con zod, con valores por defecto):
```json
{
  "thresholds": {
    "soiling_deviation_pct": 12,
    "soiling_consecutive_days": 3,
    "sudden_drop_pct": 40,
    "offline_hours": 4,
    "rain_reset_mm": 2,
    "min_valid_irradiation_kwh_m2": 2.0,
    "min_data_completeness_pct": 80,
    "neighbor_radius_km": 5,
    "neighbor_min_count": 3,
    "zone_event_pct": 60
  },
  "defaults": {
    "noct_c": 45,
    "gamma_pct_per_c": -0.40,
    "tilt_deg": 20,
    "azimuth_deg": 180,
    "tariff_mxn_per_kwh": 3.5,
    "co2_kg_per_kwh": 0.438
  },
  "notifications": { "alert_emails": [], "auto_send_client_reports": false }
}
```
> `co2_kg_per_kwh` y `tariff_mxn_per_kwh` son configurables por la empresa. ⚠️ El PO debe confirmar el factor de emisión vigente publicado para México antes de producción.

### `users`
id, company_id (null solo para superadmin), email (unique, en minúsculas), password_hash, name, role (`superadmin`, `company_admin`, `operator`, `technician`), status (`invited`, `active`, `disabled`), last_login_at.

### `invitations` 🔒
company_id, email, role, token_hash, expires_at, accepted_at, invited_by.

### `refresh_tokens`
user_id, token_hash, expires_at, revoked_at, replaced_by.

### `audit_log` 🔒 (company_id nullable para acciones de plataforma)
company_id, user_id, action, entity_type, entity_id, metadata jsonb, ip.

### `job_runs`
job_name, company_id null, started_at, finished_at, status, error, stats jsonb.

## Inventario

### `clients` 🔒
| Campo | Tipo | Notas |
|-------|------|-------|
| name | text | |
| contact_name, phone, email | text null | |
| address | text | |
| colonia | text | |
| postal_code | text | 5 dígitos |
| city | text | por defecto Culiacán |
| state | text | por defecto Sinaloa |
| lat, lon | numeric(9,6) | |
| cfe_tariff | text null | ej. `1F`, `DAC`, `PDBT`, `GDMTH` |
| avg_monthly_kwh | numeric null | consumo base del recibo |
| avg_monthly_bill_mxn | numeric null | |
| tariff_mxn_per_kwh | numeric null | si es null se usa el default de la empresa |
| report_email | text null | destinatario del reporte mensual |
| deleted_at | timestamptz null | |

### `solar_plants` 🔒
| Campo | Tipo | Notas |
|-------|------|-------|
| client_id | uuid FK | |
| name | text | |
| capacity_kwp | numeric(8,2) | > 0 |
| tilt_deg | numeric | 0–90, default de empresa |
| azimuth_deg | numeric | 0–360, 180 = sur |
| noct_c | numeric | default 45 |
| gamma_pct_per_c | numeric | default −0.40 (se guarda negativo) |
| panel_model | text null | |
| panel_count | int null | |
| inverter_brand | enum `simulator`, `goodwe`, `huawei`, `fronius`, `enphase`, `other` | |
| inverter_model, inverter_serial | text null | |
| commissioning_date | date null | |
| lat, lon | numeric null | si es null se usan las del cliente |
| postal_code, colonia | text | copiadas del cliente si no se especifican (para agrupar por zona) |
| status | enum `active`, `paused`, `decommissioned` | |
| last_reading_at | timestamptz null | |
| last_power_kw | numeric null | |
| simulation_profile | jsonb null | solo si `inverter_brand = simulator` (ver `04`) |
| deleted_at | timestamptz null | |

Índices: `(company_id, postal_code)`, `(company_id, status)`.

### `inverter_credentials` 🔒
plant_id (unique), provider, ciphertext bytea, iv bytea, auth_tag bytea, key_version int, last_test_at, last_test_ok bool.

## Series de tiempo

### `telemetry_readings` 🔒
| Campo | Tipo |
|-------|------|
| plant_id | uuid |
| ts | timestamptz (inicio del intervalo de 15 min) |
| power_kw | numeric |
| energy_kwh | numeric (energía de **este intervalo**, calculada en la ingesta) |
| energy_today_kwh | numeric null (contador del inversor) |
| inverter_temp_c | numeric null |
| status_code | text null |

PK `(plant_id, ts)`. Índice BRIN en `ts`. Retención de datos crudos: 13 meses (job mensual de limpieza); las métricas diarias se conservan siempre.

### `plant_weather_hourly` 🔒
plant_id, ts (inicio de la hora), poa_wm2, ghi_wm2, temp_amb_c, cloud_cover_pct, precipitation_mm, source. PK `(plant_id, ts)`.

> El clima se pide por ubicación y orientación; plantas con el mismo `lat/lon` (redondeado a 2 decimales), `tilt` y `azimuth` comparten la llamada al proveedor, pero se guarda una fila por planta para simplificar las consultas.

### `plant_daily_metrics` 🔒 — tabla central para alertas, chat y reportes
| Campo | Tipo | Descripción |
|-------|------|-------------|
| plant_id | uuid | |
| date | date | día local de la planta |
| energy_kwh | numeric | energía real del día |
| irradiation_poa_kwh_m2 | numeric | Σ POA del día |
| expected_stc_kwh | numeric | energía teórica STC |
| expected_temp_kwh | numeric | energía esperada corregida por temperatura |
| specific_yield_kwh_kwp | numeric | energy_kwh / capacity_kwp |
| pr | numeric | PR clásico |
| pr_temp | numeric | PR corregido por temperatura |
| pr_baseline | numeric null | línea base vigente |
| baseline_source | enum `own`, `neighbors`, `default` null | origen de la línea base (ver `05` §4) |
| deviation_pct | numeric null | desviación contra línea base |
| neighbor_index | numeric null | PR_temp de la planta / mediana de vecinas |
| neighbor_count | int | |
| temp_amb_max_c, t_cell_max_c | numeric | |
| cloud_cover_avg_pct | numeric | |
| rain_mm | numeric | |
| data_completeness_pct | numeric | |
| is_valid_day | bool | |
| invalid_reason | text null | `low_irradiation`, `incomplete_data`, `offline`, `no_weather` |
| soiling_slope_pct_per_day | numeric null | |
| days_to_cleaning | int null | predicción |
| prediction_confidence | enum `low`, `medium`, `high` null | |
| zone_event | bool | toda la zona bajó ese día (ver `06` §1) |
| status | enum `ok`, `warning`, `critical`, `offline`, `no_data` | |

PK `(plant_id, date)`. Índices: `(company_id, date)`, `(company_id, date, postal_code)`. Se desnormaliza `postal_code`, `colonia` y `client_id` aquí para agrupar rápido por zona.

### `plant_events` 🔒
plant_id, type (`cleaning`, `rain_cleaning`, `repair`, `inverter_replaced`, `commissioning`, `note`), occurred_at, source (`ticket`, `auto`, `manual`), ticket_id null, notes.
Un evento `cleaning` o `rain_cleaning` **reinicia** la ventana de cálculo de suciedad (ver `06`).

## Operación

### `alerts` 🔒
| Campo | Tipo |
|-------|------|
| plant_id | uuid |
| type | enum `offline`, `sudden_drop`, `soiling`, `cleaning_due_soon` |
| severity | enum `info`, `warning`, `critical` |
| status | enum `open`, `acknowledged`, `resolved`, `dismissed` |
| detected_at, resolved_at | timestamptz |
| resolution | enum `auto`, `ticket`, `manual` null |
| evidence | jsonb (métricas que la dispararon; ver `06`) |
| ai_explanation | jsonb null (ver `07`) |
| ai_status | enum `pending`, `done`, `failed`, `skipped` |
| ticket_id | uuid null |

Regla: **máximo una alerta abierta por (plant_id, type)**; índice único parcial `WHERE status IN ('open','acknowledged')`.

### `maintenance_tickets` 🔒
plant_id, alert_id null, type (`cleaning`, `inspection`, `repair`, `other`), status (`pending`, `scheduled`, `in_progress`, `resolved`, `cancelled`), priority (`low`, `normal`, `high`), title, description, assigned_to (user_id null), scheduled_for date null, resolved_at, resolution_notes, cleaning_performed bool, created_by.

### `notifications` 🔒
channel (`email`), recipient, subject, template, payload jsonb, status (`queued`, `sent`, `failed`), related_type, related_id, sent_at, error.

### `monthly_reports` 🔒
client_id, period (`YYYY-MM`), status (`pending`, `generated`, `sent`, `failed`), facts jsonb (cifras calculadas), narrative text, narrative_source (`ai`, `template`), storage_key, sent_to, sent_at. Unique `(client_id, period)`.

## IA

### `ai_conversations` 🔒
user_id, title, last_message_at.

### `ai_messages` 🔒
conversation_id, role (`user`, `assistant`, `tool`), content jsonb (texto y bloques), tool_name null, tool_input jsonb null, tool_output_summary jsonb null, model, input_tokens, output_tokens, latency_ms.

### `ai_usage_monthly` 🔒
period, feature (`chat`, `alert_explanation`, `report_narrative`), input_tokens, output_tokens, requests. Unique `(company_id, period, feature)`.

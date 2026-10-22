# 06 — Alertas inteligentes y tickets

Las reglas son funciones puras en `packages/core/alerts`: reciben las métricas diarias y los eventos, y devuelven acciones (`open`, `update`, `resolve`). El job `alerts.evaluate` las aplica en la base de datos. Todos los umbrales salen de `companies.settings.thresholds`.

## 1. Evento de zona (supresión de falsas alarmas)
Se evalúa antes que las demás reglas, por empresa y fecha:
- Se agrupan las plantas con día válido por código postal (o por el radio de vecinas).
- Si en un grupo con ≥ `neighbor_min_count` plantas, al menos `zone_event_pct` % (60 %) tienen `deviation_pct > soiling_deviation_pct`, ese día se marca `zone_event = true` para todas las plantas del grupo.
- Un día con `zone_event` **no** cuenta para `sudden_drop` ni para `soiling`: si toda la zona bajó, es clima (polvo, humo, nubosidad mal reportada), no una falla de una planta.
- Se agrega la columna `zone_event bool default false` a `plant_daily_metrics`.

## 2. Reglas

### `offline` — se evalúa cada hora
- Condición: la planta lleva más de `offline_hours` (4) **horas con sol** sin lecturas.
- Si la causa es un error de integración nuestro (`provider_error` en la ingesta: credenciales inválidas, API caída), **no** se crea alerta de planta. Se muestra como "problema de conexión" en la planta y en el panel de la empresa.
- Severidad `critical`.
- Se resuelve sola cuando vuelven a llegar lecturas.

### `sudden_drop` — falla de inversor o de string
Se evalúa sobre días válidos sin `zone_event`:
- **Crítica:** `deviation_pct ≥ sudden_drop_pct` (40) y el día válido anterior tenía `deviation_pct < 15`.
- **Advertencia:** `deviation_pct ≥ 20` durante 2 días válidos seguidos, el día válido previo a ese par tenía `deviation_pct < 10`, y `neighbor_index < 0.8` (o `null`).
  - Motivo: si falla 1 de 3 strings la pérdida es de ~33 %, y una regla de solo 40 % nunca la detectaría.
- El salto de un día para otro distingue esta falla de la suciedad, que es gradual.
- Se resuelve sola cuando `deviation_pct < 10` durante 2 días válidos.

### `soiling` — posible suciedad
Se evalúa sobre días válidos sin `zone_event`:
- `deviation_pct > soiling_deviation_pct` (12) en `soiling_consecutive_days` (3) días válidos consecutivos. Los días inválidos intermedios se saltan sin romper la racha, pero la racha debe caber en 7 días calendario.
- No hubo lluvia ≥ `rain_reset_mm` en esos días.
- `soiling_slope_pct_per_day < 0` (tendencia descendente) o, si no hay pendiente calculable, no se cumplió la regla de `sudden_drop`.
- Severidad `warning`.
- Se resuelve cuando:
  - Ocurre un evento `cleaning` o `rain_cleaning` y el siguiente día válido tiene `deviation_pct < 5`; o
  - `deviation_pct < 5` durante 2 días válidos.
- **Si hubo lavado y la desviación sigue > 12 % en los 2 días válidos siguientes:** la alerta se mantiene abierta, se agrega a la evidencia `cleaning_did_not_recover: true` y se vuelve a generar la explicación IA. Esto indica que la causa no era suciedad (sombra nueva, degradación, falla parcial).

### `cleaning_due_soon` — aviso preventivo
- `days_to_cleaning` entre 1 y 7 con confianza `medium` o `high`, y no hay alerta `soiling` abierta.
- Severidad `info`. No envía correo individual; aparece en el resumen diario y en el tablero.
- Se resuelve sola cuando se abre la alerta `soiling` o cuando hay un evento de limpieza.

## 3. Evidencia (`alerts.evidence`)
Se guarda al abrir la alerta y se actualiza mientras siga abierta:
```json
{
  "rule": "soiling",
  "trigger": { "deviation_pct": [13.1, 14.0, 15.2], "dates": ["2026-10-18", "2026-10-19", "2026-10-21"] },
  "baseline": { "value": 0.91, "source": "own" },
  "trend": { "slope_pct_per_day": -0.42, "r2": 0.81, "days_since_reset": 34, "last_reset": { "type": "rain_cleaning", "date": "2026-09-17" } },
  "neighbors": { "count": 6, "neighbor_index": 0.86 },
  "weather": { "rain_mm_14d": 0, "cloud_cover_avg_pct_3d": 8, "temp_amb_max_c_3d": 36 },
  "last_14_days": [ { "date": "…", "pr_temp": 0.79, "deviation_pct": 13.1, "neighbor_index": 0.87, "rain_mm": 0, "valid": true } ],
  "cleaning_did_not_recover": false
}
```
Esta evidencia es lo que se le pasa a la IA para generar la explicación (ver `07`), y lo que se muestra en el detalle de la alerta.

## 4. Ciclo de vida
- Máximo una alerta abierta por planta y tipo (índice único parcial). Si la condición se repite, se actualiza la evidencia de la existente.
- Estados: `open` → `acknowledged` (alguien la vio) → `resolved` (auto, por ticket o manual) o `dismissed` (descartada, con motivo obligatorio).
- Al crearse una alerta `warning` o `critical`: se encola `ai.explain_alert` y `notifications.send`.

## 5. Tickets de mantenimiento
- Desde una alerta: botón "Crear ticket" con datos prellenados.
  - `soiling` → tipo `cleaning`; `sudden_drop` y `offline` → tipo `inspection`.
  - La descripción incluye el resumen de la explicación IA si ya existe.
- También se pueden crear manualmente desde la planta.
- El técnico ve sus tickets en el celular, cambia el estado, agrega notas y marca `cleaning_performed`.
- Al resolver un ticket con `cleaning_performed = true` se crea un `plant_event` de tipo `cleaning` (con fecha `resolved_at`). Eso reinicia la tendencia de suciedad y sirve para auto-resolver la alerta.
- Resolver un ticket ligado a una alerta **no** la resuelve automáticamente, salvo que la regla de resolución se cumpla. Así se comprueba con datos que el problema se corrigió.

## 6. Notificaciones por correo (v1)
| Evento | Destinatarios | Cuándo |
|--------|---------------|--------|
| Nueva alerta `critical` | `alert_emails` + `company_admin` | inmediato |
| Nueva alerta `warning` | `alert_emails` + `company_admin` | inmediato |
| Resumen diario | `alert_emails` + `company_admin` + `operator` | 07:00 local: alertas abiertas, lavados próximos, plantas offline |
| Ticket asignado | técnico asignado | inmediato |
| Reporte mensual | `client.report_email` | ver `08` |

Reglas: un solo correo por alerta (no se repite mientras siga abierta); las plantillas en español y con la marca de la empresa; enlace directo a la alerta o ticket.

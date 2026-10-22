# 05 — Motor de rendimiento

Todas las fórmulas viven en `packages/core/performance` como **funciones puras**, sin acceso a base de datos. El job `metrics.daily` reúne los datos, llama a estas funciones y guarda el resultado en `plant_daily_metrics`.

## Corrección importante respecto al documento previo
El factor de temperatura **no** se aplica una sola vez al día. La temperatura de celda cambia hora por hora: a mediodía en Culiacán puede pasar de 65 °C y a las 8:00 estar en 35 °C. Por eso la energía esperada se calcula **por hora** y luego se suma. Aplicar un solo factor diario subestima la pérdida por calor en las horas de más producción y genera falsas alarmas.

## 1. Cálculo por hora
Para cada hora `h` del día local de la planta con clima disponible:

```
G_h       = POA promedio de la hora (W/m²)
H_h       = G_h / 1000                                  (kWh/m² en 1 h)
T_cell_h  = T_amb_h + (NOCT − 20) / 800 × G_h
F_temp_h  = clamp(1 + (γ / 100) × (T_cell_h − 25), 0.5, 1.10)
E_stc_h   = kWp × H_h                                   (energía teórica STC, G_stc = 1000 W/m²)
E_exp_h   = E_stc_h × F_temp_h                          (energía esperada corregida por temperatura)
E_real_h  = Σ energy_kwh de los intervalos de 15 min de esa hora
```
- `γ` se guarda en %/°C y es negativo (por ejemplo −0.40).
- Una hora está **cubierta** si tiene clima y al menos 3 de sus 4 intervalos de telemetría.

## 2. Agregados diarios
```
energy_kwh              = Σ energy_kwh de todo el día (para reportes)
irradiation_poa_kwh_m2  = Σ H_h de todas las horas
expected_stc_kwh        = Σ E_stc_h de todas las horas
expected_temp_kwh       = Σ E_exp_h de todas las horas
specific_yield          = energy_kwh / kWp

PR       = Σ E_real_h / Σ E_stc_h        (solo horas cubiertas)
PR_temp  = Σ E_real_h / Σ E_exp_h        (solo horas cubiertas)

data_completeness_pct = 100 × Σ E_stc_h(cubiertas) / Σ E_stc_h(todas las horas con sol)
```
Numerador y denominador usan **las mismas horas**: si faltan datos de una hora, no se castiga el PR.
La completitud se pondera por irradiancia: perder la hora de mediodía pesa más que perder las 7:00.

## 3. Día válido
`is_valid_day = true` solo si se cumplen todas:
- `irradiation_poa_kwh_m2 ≥ min_valid_irradiation_kwh_m2` (por defecto 2.0); si no, `invalid_reason = low_irradiation`.
- `data_completeness_pct ≥ min_data_completeness_pct` (80); si no, `incomplete_data`.
- Hubo telemetría; si no, `offline`.
- Hubo clima; si no, `no_weather`.

Solo los días válidos alimentan la línea base, la comparación con vecinas y las reglas de suciedad.

## 4. Línea base (`pr_baseline`)
Representa el PR_temp de la planta "limpia y sana".
- **Propia:** percentil 80 de `PR_temp` de los días válidos de los últimos 90 días (sin incluir el día evaluado), excluyendo días con alerta `sudden_drop` activa. Requiere al menos 10 días válidos.
  - Se usa P80 en lugar del promedio porque en temporada seca (sin lluvia por meses) la suciedad baja el PR gradualmente y un promedio "aprendería" la suciedad como normal.
- **Provisional:** si hay menos de 10 días válidos (planta nueva), se usa la mediana de las líneas base propias de las plantas vecinas (ver §6). Si tampoco hay, `0.85`.
- Agregar en `plant_daily_metrics` la columna `baseline_source` (`own`, `neighbors`, `default`).

## 5. Desviación
```
deviation_pct = 100 × (pr_baseline − PR_temp) / pr_baseline
```
Positiva = la planta rinde **por debajo** de su normal.

## 6. Índice frente a vecinas
- Vecinas: plantas **de la misma empresa** con día válido en la misma fecha, a ≤ `neighbor_radius_km` (5 km, distancia haversine), sin contar la planta evaluada. Si son menos de `neighbor_min_count` (3), se usan las del mismo código postal. Si tampoco alcanzan, `neighbor_index = null`.
- Cada planta se normaliza contra su propia línea base, porque cada instalación tiene un rendimiento distinto:
```
r_i            = PR_temp_i / pr_baseline_i
neighbor_index = r_planta / mediana(r_vecinas)
```
- `≈ 1.0`: la planta se comporta igual que su zona. `< 0.88`: rinde peor que sus vecinas ese día, así que probablemente no es el clima.
- No se comparan plantas de otras empresas (privacidad entre tenants). Ver `13-roadmap-v2.md`.

## 7. Tendencia de suciedad y predicción de lavado
- **Evento de reinicio:** el más reciente entre `plant_events` de tipo `cleaning`, `rain_cleaning` o `repair`. El job `metrics.daily` crea automáticamente un `rain_cleaning` cuando `rain_mm ≥ rain_reset_mm`.
- Puntos: días válidos desde el reinicio hasta hoy, con `r = PR_temp / pr_baseline`. Se requieren al menos 7 puntos; si no, todo queda en `null`.
- Regresión lineal por mínimos cuadrados de `r` (en %) contra días → `soiling_slope_pct_per_day` y `R²`.
- `r_hoy` = valor de la recta en el día de hoy. Umbral `r_th = 100 − soiling_deviation_pct` (88).
- Predicción:
  - Si `r_hoy ≤ r_th` → `days_to_cleaning = 0`.
  - Si `slope < −0.05` → `days_to_cleaning = ceil((r_hoy − r_th) / −slope)`; si el resultado es mayor que 120, `null`.
  - Si no → `null` (no hay tendencia de suciedad).
- Confianza: `high` si R² ≥ 0.7 y n ≥ 14; `medium` si R² ≥ 0.4; si no, `low`.

## 8. Estado diario de la planta
En orden de prioridad:
1. `no_data`: no hay clima.
2. `offline`: no hubo telemetría con sol.
3. `critical`: tiene alerta abierta de severidad `critical`.
4. `warning`: `deviation_pct > soiling_deviation_pct` o `days_to_cleaning ≤ 7` o alerta abierta `warning`.
5. `ok`.

## 9. Job `metrics.daily`
- Por empresa, a las 22:00 de su zona horaria, para el día local actual. También se puede ejecutar a mano para un rango de fechas (recálculo).
- Pasos por planta: cargar telemetría y clima del día → §1–3 → §4–5 → §7. Después, con todas las plantas del día listas → §6 → §8.
- Idempotente: upsert por `(plant_id, date)`.
- Al terminar encola `alerts.evaluate` para esa empresa y fecha.

## 10. Pruebas obligatorias (`packages/core`)

**Caso A — una hora en Culiacán (5 kWp, NOCT 45, γ −0.40):**
G = 900 W/m², T_amb = 38 °C, E_real = 3.2 kWh
- T_cell = 38 + 25/800 × 900 = **66.125 °C**
- F_temp = 1 − 0.004 × 41.125 = **0.8355**
- E_stc = 4.5 kWh; E_exp = **3.75975 kWh**
- PR = 3.2 / 4.5 = **0.7111**; PR_temp = 3.2 / 3.75975 = **0.8511**

Sin corrección, el sistema vería un PR de 71 % y alarmaría; corregido, la planta está bien (85 %).

**Caso B — día de tres horas (mismos parámetros):**
| Hora | G | T_amb | T_cell | F_temp | E_stc | E_exp | E_real |
|------|---|-------|--------|--------|-------|-------|--------|
| 1 | 400 | 30 | 42.5 | 0.93 | 2.0 | 1.86 | 1.6 |
| 2 | 900 | 38 | 66.125 | 0.8355 | 4.5 | 3.75975 | 3.2 |
| 3 | 600 | 36 | 54.75 | 0.881 | 3.0 | 2.643 | 2.3 |

Σ E_real = 7.1; Σ E_stc = 9.5; Σ E_exp = 8.26275 → **PR = 0.7474**, **PR_temp = 0.8593**.
Con línea base 0.95 → **deviation_pct = 9.55**.

**Caso C — predicción:** r_hoy = 94 %, slope = −0.3 %/día, umbral 88 → `days_to_cleaning = 20`.

**Otros casos:** hora sin cubrir excluida de PR; reinicio del contador a medianoche; día con 1.5 kWh/m² inválido; clamp de F_temp; menos de 7 puntos → predicción null; vecinas insuficientes → fallback por código postal → null.

Tolerancia en las comparaciones: ±0.0001.

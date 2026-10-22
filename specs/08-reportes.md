# 08 — Reporte mensual narrado

Reporte en PDF para el **cliente final**, con la marca de la empresa instaladora. Uno por cliente (agrupa todas sus plantas) y por mes.

## 1. Flujo
1. Job `reports.monthly` el día 1 a las 08:00 locales: crea un `monthly_reports` del mes anterior para cada cliente con al menos una planta activa en ese mes.
2. Calcula las cifras (`facts`) → genera la narrativa → genera el PDF → lo guarda en storage → `status = generated`.
3. La empresa revisa en la pantalla "Reportes" y envía uno por uno o "Enviar todos". Si `settings.notifications.auto_send_client_reports = true`, se envían solos al generarse.
4. El correo lleva el PDF adjunto y un texto breve con la marca de la empresa.
5. Se puede regenerar un reporte mientras no se haya enviado. También se puede generar a mano para cualquier mes pasado.

## 2. Cifras (`facts`) — las calcula nuestro código
```json
{
  "period": "2026-09",
  "client_name": "…",
  "plants": [{ "name": "…", "capacity_kwp": 8.2, "energy_kwh": 1043.5, "specific_yield": 127.3, "pr_temp": 0.871, "availability_pct": 99.1 }],
  "energy_kwh": 1043.5,
  "energy_prev_month_kwh": 1120.2,
  "energy_change_pct": -6.8,
  "energy_same_month_last_year_kwh": null,
  "savings_mxn": 3652.3,
  "tariff_mxn_per_kwh": 3.5,
  "co2_avoided_kg": 457.0,
  "consumption_coverage_pct": 74.5,
  "cloudy_days": 6,
  "rain_days": 4,
  "best_day": { "date": "2026-09-03", "energy_kwh": 48.1 },
  "worst_valid_day": { "date": "2026-09-21", "energy_kwh": 22.4 },
  "alerts_opened": 1,
  "alerts_resolved": 1,
  "cleanings": 1,
  "open_issues": [],
  "daily_energy": [{ "date": "2026-09-01", "energy_kwh": 37.2 }]
}
```
- `savings_mxn = energy_kwh × tarifa` (la del cliente o, si no tiene, la de la empresa). Se muestra como **estimación**.
- `co2_avoided_kg = energy_kwh × co2_kg_per_kwh` (configurable por empresa).
- `consumption_coverage_pct` solo si el cliente tiene `avg_monthly_kwh`.
- Si una planta se instaló a mitad de mes, se indica el número de días contados.
- `availability_pct` = horas con sol con telemetría / horas con sol.

## 3. Narrativa IA
- Modelo `LLM_MODEL_FAST`, temperatura ≈ 0.4. Entrada: **solo** el JSON de `facts` y el nombre de la empresa.
- Instrucciones:
  - 80–150 palabras, en español, trato de "usted", amable y claro.
  - Sin jerga técnica: no usar "PR", "irradiancia" ni "kWp". Decir "su sistema", "rendimiento", "días nublados".
  - Explicar la variación contra el mes anterior usando el clima cuando aplique (días nublados o lluviosos).
  - Si hubo alertas o limpiezas, mencionarlas de forma tranquila: qué se hizo y que el sistema se monitorea.
  - Cerrar con una línea positiva sobre el ahorro y el CO₂ evitado.
  - No prometer cifras futuras.
- **Validación de cifras** (misma función que en `07`): todo número del texto debe existir en `facts`. Si falla, se reintenta una vez y después se usa la plantilla.
- **Plantilla de respaldo** con los mismos datos, sin IA. `narrative_source = template`.

## 4. Diseño del PDF (`@react-pdf/renderer`, 1–2 páginas tamaño carta)
1. Encabezado: logo y nombre de la empresa, color de marca, "Reporte de generación solar — {Mes Año}", nombre del cliente.
2. Tarjetas: energía generada (kWh), ahorro estimado (MXN), CO₂ evitado (kg), cambio contra el mes anterior.
3. Gráfica de barras de energía diaria (SVG dibujado con primitivas de react-pdf).
4. Narrativa.
5. Tabla por planta (si tiene más de una): energía, rendimiento por kWp, disponibilidad.
6. Pie: datos de contacto de la empresa, aviso de privacidad breve y "Cifras de ahorro estimadas con base en la tarifa {x} MXN/kWh".

Requisitos: fuentes embebidas con soporte de acentos; montos en formato `$3,652.30 MXN`; fechas en español; peso menor a 1 MB.

## 5. Pruebas
- Cálculo de `facts` contra la semilla demo con valores esperados.
- Narrativa con cifra inventada (simulada con un mock) → validador la rechaza → se usa la plantilla.
- PDF generado sin errores para: cliente con una planta, con varias plantas, planta instalada a mitad de mes y mes sin datos.

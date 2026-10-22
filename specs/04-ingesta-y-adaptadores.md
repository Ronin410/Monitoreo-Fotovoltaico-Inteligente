# 04 — Ingesta de datos y adaptadores

## 1. Adaptadores de inversor

### Interfaz (`packages/adapters/inverters`)
```ts
type RawReading = {
  ts: Date;                    // marca de tiempo del proveedor
  powerKw: number;             // potencia AC instantánea o promedio
  energyTodayKwh?: number;     // contador diario del inversor
  inverterTempC?: number;
  statusCode?: string;
};

interface InverterAdapter {
  provider: InverterBrand;
  testConnection(creds: unknown): Promise<{ ok: boolean; message?: string }>;
  fetchReadings(args: {
    plant: PlantForAdapter;    // id, capacityKwp, serial, lat, lon, simulationProfile
    creds: unknown;            // descifradas, solo en memoria
    since: Date;
    until: Date;
  }): Promise<RawReading[]>;
}
```
- Cada adaptador valida con zod la forma de sus credenciales (`credsSchema`) y la respuesta del proveedor.
- Un registro `adapterRegistry[brand]` devuelve el adaptador.
- **Adaptadores reales (GoodWe, Huawei, Fronius, Enphase):** se implementan **solo** cuando el PO entregue documentación oficial y credenciales de prueba. Mientras tanto existen como esqueleto que lanza `NotImplementedError`. No se debe adivinar endpoints.

### Normalización (en el job, no en el adaptador)
1. Agrupar lecturas en intervalos de **15 minutos** (`ts` = inicio del intervalo, en UTC).
2. `power_kw` = promedio de las lecturas del intervalo.
3. `energy_kwh` del intervalo:
   - Si hay `energyTodayKwh` monotónico: diferencia contra el intervalo anterior. Si el contador baja (reinicio a medianoche) se toma el valor actual. Si hay hueco, se reparte la diferencia solo si el hueco es ≤ 1 hora; si no, se usa el método de potencia.
   - Si no hay contador: `power_kw × 0.25`.
4. Upsert por `(plant_id, ts)`.
5. Actualizar `solar_plants.last_reading_at` y `last_power_kw`.

### Job `ingest.telemetry` (cada 15 min)
- Encola una tarea por planta `active` de empresas `active`.
- Solo consulta entre **amanecer − 30 min y atardecer + 30 min** de la ubicación de la planta (calcular con `suncalc`). De noche no hay generación.
- `since = last_reading_at − 1 h` (solape para corregir datos tardíos), máximo 7 días hacia atrás.
- Concurrencia máxima por proveedor configurable (por defecto 5); backoff exponencial ante 429 o 5xx; tras 3 fallos el error se registra en `job_runs` y la planta no se marca offline por error **nuestro** (se distingue `provider_error` de "el inversor no reporta").

## 2. Adaptador de clima

### Interfaz (`packages/adapters/weather`)
```ts
type WeatherHour = {
  ts: Date;               // inicio de la hora, UTC
  poaWm2: number;         // irradiancia en el plano inclinado
  ghiWm2: number;
  tempAmbC: number;
  cloudCoverPct: number;
  precipitationMm: number;
};

interface WeatherProvider {
  name: string;
  fetchHourly(args: { lat: number; lon: number; tiltDeg: number; azimuthDeg: number; from: Date; to: Date }): Promise<WeatherHour[]>;
}
```
- Convención interna: `azimuthDeg` 180 = sur, 90 = este, 270 = oeste. Cada adaptador **convierte** a la convención de su proveedor según su documentación oficial.
- Implementaciones v1: `open-meteo` (por defecto) y `synthetic` (para pruebas y desarrollo sin red).

### Job `ingest.weather` (cada hora)
- Agrupa plantas por `(lat, lon redondeados a 2 decimales, tilt, azimuth)` para hacer una sola llamada por grupo; guarda una fila por planta en `plant_weather_hourly`.
- Pide las últimas 3 horas en cada corrida; a las 21:00 locales vuelve a pedir el día completo, porque algunos proveedores corrigen valores.
- Al crear una planta: backfill de clima de 90 días si el proveedor lo permite.

### Proveedor `synthetic`
- POA de cielo despejado a partir de la elevación solar (`suncalc`): `poa_clear ≈ 1000 × sin(elevación)^1.15`, ajustado por inclinación de forma aproximada (suficiente para demo y pruebas).
- Días nublados aleatorios con semilla fija: entre 10 % y 20 % de los días, con factor 0.2–0.6 sobre la irradiancia; lluvia ligada a algunos de esos días.
- Temperatura ambiente con ciclo diario: mínima ~25 °C al amanecer y máxima configurable (por defecto 38 °C) a las 15:00.

## 3. Simulador de inversor (adaptador `simulator`)

Permite hacer la demo y las pruebas sin inversores reales. Genera la telemetría **a partir del clima guardado** de la planta, así el motor de rendimiento ve datos coherentes.

### Modelo por intervalo de 15 min
```
G      = POA del clima (W/m²)
T_cell = T_amb + (NOCT − 20) / 800 × G
F_temp = 1 + (γ/100) × (T_cell − 25)
P_dc   = kWp × (G / 1000) × F_temp
P_ac   = P_dc × eficiencia_sistema × factor_suciedad × factor_falla × factor_sombra × (1 + ruido)
P_ac   = min(P_ac, ac_limit_kw)   // recorte del inversor
```
- `eficiencia_sistema` por planta: 0.86–0.92.
- `ruido`: normal con σ = 2 %, con semilla `hash(plant_id, ts)` (determinista).

### `simulation_profile` (jsonb en la planta)
```json
{
  "seed": 1234,
  "system_efficiency": 0.89,
  "ac_limit_kw": 9.0,
  "noise_pct": 2,
  "scenarios": [
    { "type": "soiling", "start": "2026-08-01", "rate_pct_per_day": 0.35 },
    { "type": "string_failure", "start": "2026-09-14", "loss_pct": 33, "end": null },
    { "type": "offline", "start": "2026-10-20T15:00:00Z", "end": null },
    { "type": "shading", "start": "2026-07-01", "loss_pct": 25, "local_hours": [16, 17, 18] }
  ]
}
```
- **Suciedad:** la pérdida crece linealmente desde `start` y **se reinicia a 0** cuando hay lluvia ≥ `rain_reset_mm` en el clima, o cuando existe un evento `cleaning` en `plant_events` (al resolver un ticket de limpieza). Así la demo muestra que el lavado "funciona".
- **Falla de string:** escalón de pérdida desde `start` hasta `end`.
- **Offline:** el simulador no devuelve lecturas en esa ventana.
- **Sombra:** pérdida solo en ciertas horas locales.

## 4. Semilla de demo (`pnpm db:seed:demo`)
- **Empresa A — "Solar Demo Culiacán"**: 1 `company_admin`, 1 `operator`, 2 `technician`; 20 clientes y 25 plantas (residenciales de 3–12 kWp y comerciales de 20–100 kWp) repartidas en 6–8 colonias reales de Culiacán (por ejemplo Centro, Las Quintas, Tres Ríos, Chapultepec, Guadalupe, Infonavit Humaya, Villa Universidad). ⚠️ Validar código postal y coordenadas de cada colonia; usar puntos aproximados dentro de la colonia, nunca domicilios reales.
- Escenarios en la empresa A:
  - 15 plantas normales.
  - 4 con suciedad en distintas etapas (una a punto de cruzar el umbral, otra ya con alerta).
  - 2 con falla de string (una reciente, una de hace semanas con ticket abierto).
  - 1 offline actualmente.
  - 1 con sombra por la tarde.
  - 2 instaladas hace menos de 20 días (sin línea base suficiente).
- **Empresa B — "Demo Mazatlán"**: 5 plantas. Sirve para probar el aislamiento entre empresas y el chat.
- 90 días de historia: clima (sintético o real), telemetría simulada, métricas diarias, alertas y tickets ya procesados por los jobs reales (la semilla **ejecuta** el pipeline; no inserta métricas a mano).
- Un usuario `superadmin`.
- Credenciales de demo impresas en consola, nunca guardadas en el repositorio.

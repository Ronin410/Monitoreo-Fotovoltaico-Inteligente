# 01 — Arquitectura

## Stack
| Capa | Tecnología | Motivo |
|------|-----------|--------|
| Lenguaje | TypeScript estricto en todo el repo | Un solo lenguaje y tipos compartidos |
| Frontend | Next.js (App Router), Tailwind CSS, lucide-react, Recharts, Leaflet + OpenStreetMap | Pedido en la documentación original; Leaflet no requiere llave de API |
| API | Node.js + Express, validación con `zod` | Pedido en la documentación original |
| Base de datos | PostgreSQL (Render Postgres) | Relacional, con RLS para aislamiento |
| ORM | Prisma + migraciones SQL manuales para RLS e índices especiales | Muy conocido por los agentes de IA |
| Colas y jobs | `pg-boss` (colas y cron sobre PostgreSQL) | **Sustituye a Redis en v1**: un servicio menos que pagar y operar |
| IA | Capa propia `packages/ai` con interfaz `LLMProvider`; implementación por defecto con la API de Claude (Anthropic SDK) | Se puede cambiar de proveedor sin tocar la lógica |
| PDF | `@react-pdf/renderer` | Sin navegador headless, fácil de desplegar |
| Correo | Interfaz `EmailProvider`; implementación con Resend o SMTP (nodemailer) | Intercambiable |
| Archivos | Interfaz `StorageProvider`; disco local en desarrollo y S3 compatible (Cloudflare R2 o S3) en producción | Logos y PDFs |
| Pruebas | Vitest (unitarias e integración), Supertest (API), Playwright (E2E opcional) | |
| CI | GitHub Actions: lint, typecheck y tests en cada push | |

### Decisiones respecto a la documentación original
- **Go descartado** para v1: Node basta para la carga esperada (cientos de plantas con lectura cada 15 min) y mantiene un solo lenguaje.
- **Redis descartado** para v1: `pg-boss` cubre colas y cron. El "estado en tiempo real" se lee de la última lectura en PostgreSQL (`solar_plants.last_reading_at` y `last_power_kw`). Redis se puede agregar si la carga lo exige.
- **OpenWeatherMap reemplazado** como opción por defecto: se necesita **irradiancia en el plano inclinado** del panel. El adaptador por defecto es Open-Meteo, que puede devolver irradiancia inclinada dados `tilt` y `azimuth`. ⚠️ **Antes de producción verificar los términos de uso comercial** del proveedor elegido; la interfaz `WeatherProvider` permite cambiarlo (por ejemplo, Solcast).

## Estructura del monorepo (pnpm workspaces)
```
/
├─ CLAUDE.md
├─ specs/
├─ apps/
│  ├─ web/        # Next.js (UI)
│  ├─ api/        # Express (REST + SSE del chat)
│  └─ worker/     # pg-boss: ingesta, clima, métricas, alertas, IA, reportes
├─ packages/
│  ├─ core/       # Fórmulas y reglas como funciones puras + tipos compartidos
│  ├─ db/         # Prisma schema, cliente, helpers de tenant, migraciones RLS
│  ├─ adapters/   # Inversores (simulador + marcas), clima, email, storage
│  ├─ ai/         # LLMProvider, herramientas del chat, prompts, validadores
│  └─ config/     # eslint, tsconfig y carga de variables de entorno con zod
├─ render.yaml    # Blueprint de Render
└─ .github/workflows/ci.yml
```

Reglas:
- `packages/core` **no** importa base de datos ni red. Todo es determinista y probable con números fijos.
- `apps/api` y `apps/worker` acceden a datos **solo** a través de los repositorios con tenant de `packages/db` (ver `02`).

## Despliegue (Render)
| Servicio | Tipo en Render |
|----------|----------------|
| `pv-web` | Web Service (Next.js) |
| `pv-api` | Web Service (Express) |
| `pv-worker` | Background Worker (pg-boss) |
| `pv-db` | PostgreSQL |

Ambientes: `staging` (pruebas y demo) y `production`. Las migraciones se ejecutan en el comando de pre-deploy de `pv-api`.

## Variables de entorno (validadas con zod al arrancar)
```
DATABASE_URL=
APP_URL=                     # URL pública del web
API_URL=
JWT_SECRET=                  # mínimo 32 bytes
REFRESH_TOKEN_SECRET=
CREDENTIALS_ENC_KEY=         # 32 bytes en base64, para AES-256-GCM
CREDENTIALS_KEY_VERSION=1
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=
LLM_MODEL_CHAT=claude-sonnet-5-5     # chat analítico
LLM_MODEL_FAST=claude-haiku-5-5      # explicaciones de alertas y narrativa de reportes
WEATHER_PROVIDER=open-meteo
WEATHER_API_KEY=             # opcional según proveedor
EMAIL_PROVIDER=resend|smtp
EMAIL_FROM=
RESEND_API_KEY= / SMTP_*
STORAGE_PROVIDER=local|s3
S3_ENDPOINT= S3_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY=
SIMULATOR_ENABLED=true       # en staging/demo
DEFAULT_TIMEZONE=America/Mazatlan
```

## Jobs (worker)
| Job | Frecuencia | Descripción |
|-----|-----------|-------------|
| `ingest.telemetry` | cada 15 min | Lee inversores de cada planta activa (ver `04`) |
| `ingest.weather` | cada hora | Clima por ubicación y orientación (ver `04`) |
| `metrics.daily` | diario 22:00 hora local de la empresa | Calcula `plant_daily_metrics` del día (ver `05`) |
| `alerts.evaluate` | después de `metrics.daily` y cada hora para desconexión | Reglas de `06` |
| `ai.explain_alert` | al crear una alerta | Explicación IA (ver `07`) |
| `reports.monthly` | día 1 de cada mes, 08:00 local | Reportes del mes anterior (ver `08`) |
| `notifications.send` | por evento | Correos |

Todos los jobs: idempotentes (se pueden repetir sin duplicar datos), con reintentos con backoff exponencial y registro de errores. Cada job recibe el `company_id` explícito y opera dentro del contexto de esa empresa.

## Observabilidad
- Logs estructurados en JSON (pino) con `company_id`, `plant_id`, `job` y `request_id`. **Nunca** se registran credenciales ni tokens.
- Endpoint `GET /health` en api y heartbeat del worker.
- Tabla `job_runs` para ver en el panel de superadmin la última ejecución exitosa por job.

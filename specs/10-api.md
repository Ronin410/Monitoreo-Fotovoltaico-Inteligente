# 10 — API REST (apps/api)

Base: `/api`. JSON. Autenticación con `Authorization: Bearer <access_token>`, salvo los endpoints de auth.
- Errores: `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [...] } }`.
- Paginación: `?page=1&page_size=25` (máximo 100); respuesta `{ "data": [...], "page": 1, "page_size": 25, "total": 123 }`.
- Fechas en ISO 8601 UTC; los rangos de días como `YYYY-MM-DD` en la zona horaria de la empresa.
- Recursos de otra empresa → **404**.
- Columna "Rol" = roles mínimos (ver la matriz de `02`).

## Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | correo y contraseña → access token + cookie de refresh |
| POST | `/auth/refresh` | rota el refresh token |
| POST | `/auth/logout` | revoca el refresh token |
| POST | `/auth/forgot-password` | envía correo (siempre responde 200) |
| POST | `/auth/reset-password` | token + nueva contraseña |
| GET | `/auth/invitations/:token` | valida invitación |
| POST | `/auth/invitations/:token/accept` | nombre + contraseña |
| GET | `/me` | usuario, rol y empresa (marca incluida) |

## Empresa y usuarios
| Método | Ruta | Rol |
|--------|------|-----|
| GET / PATCH | `/company` | admin (GET: todos) |
| POST | `/company/logo` | admin |
| GET | `/company/users` | admin |
| POST | `/company/invitations` | admin |
| PATCH | `/company/users/:id` | admin (rol, estado) |
| GET | `/company/ai-usage` | admin |

## Clientes y plantas
| Método | Ruta | Rol |
|--------|------|-----|
| GET / POST | `/clients` | operator |
| GET / PATCH / DELETE | `/clients/:id` | operator (DELETE = lógico) |
| GET / POST | `/plants` | operator (GET con filtros `status`, `postal_code`, `colonia`, `brand`, `q`, `sort`) |
| GET / PATCH / DELETE | `/plants/:id` | operator |
| PUT | `/plants/:id/credentials` | operator (solo escritura) |
| POST | `/plants/:id/credentials/test` | operator |
| GET | `/plants/:id/today` | operator, technician con ticket: potencia real y esperada en intervalos de 15 min |
| GET | `/plants/:id/daily-metrics?from&to` | operator |
| GET / POST | `/plants/:id/events` | operator |

## Tablero
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/dashboard/summary` | tarjetas del tablero |
| GET | `/dashboard/map` | plantas con lat, lon y estado |
| GET | `/dashboard/upcoming-cleanings?days=14` | |
| GET | `/dashboard/top-bottom?days=30` | |

## Alertas y tickets
| Método | Ruta | Rol |
|--------|------|-----|
| GET | `/alerts` | operator (filtros `status`, `type`, `severity`, `plant_id`, `postal_code`) |
| GET | `/alerts/:id` | operator |
| POST | `/alerts/:id/acknowledge` | operator |
| POST | `/alerts/:id/dismiss` | operator (motivo obligatorio) |
| POST | `/alerts/:id/regenerate-explanation` | operator |
| POST | `/alerts/:id/ticket` | operator |
| GET / POST | `/tickets` | operator (technician: solo los suyos) |
| GET / PATCH | `/tickets/:id` | operator, technician asignado |

## Asistente IA
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ai/conversations` | del usuario actual |
| GET | `/ai/conversations/:id` | mensajes |
| DELETE | `/ai/conversations/:id` | |
| POST | `/ai/chat` | **SSE**. Body `{ conversation_id?, message }` (máximo 2,000 caracteres) |

## Reportes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/reports?period=YYYY-MM` | lista con estado por cliente |
| POST | `/reports/generate` | `{ period, client_ids? }` encola generación |
| GET | `/reports/:id/pdf` | descarga (URL firmada o stream) |
| POST | `/reports/:id/send` | |
| POST | `/reports/send-all` | `{ period }` |

## Superadmin (`/admin`)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET / POST | `/admin/companies` | listar y crear empresas |
| PATCH | `/admin/companies/:id` | estado, plan, presupuesto de IA |
| GET | `/admin/health` | job_runs, errores de integración |

## Otros
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | sin auth |

Todas las rutas definen sus esquemas zod de entrada y salida en `apps/api/src/routes/**/schemas.ts`, y se genera un documento OpenAPI a partir de ellos (`zod-to-openapi`) disponible en `/api/docs` solo en staging.

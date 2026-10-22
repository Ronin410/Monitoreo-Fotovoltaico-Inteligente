-- Row Level Security y roles de base de datos (ver specs/02-multi-tenant-y-seguridad.md).
--
-- Roles (de grupo, sin LOGIN; los usuarios de conexión se crean aparte y se agregan como
-- miembros, ver packages/db/README.md):
-- - pv_app:     rol de la aplicación (api y worker). No es dueño de las tablas ni tiene
--               BYPASSRLS. Solo ve filas de la empresa fijada en app.company_id.
-- - pv_service: rol de plataforma (superadmin, autenticación antes de conocer la empresa y
--               jobs globales). Solo accede a las tablas de plataforma.
-- Las migraciones corren con el rol dueño de las tablas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pv_app') THEN
    CREATE ROLE pv_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pv_service') THEN
    CREATE ROLE pv_service NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Empresa de la transacción actual. NULL si no se fijó (entonces las políticas no dejan ver
-- nada). withTenant la fija con set_config('app.company_id', $1, true), válida solo dentro
-- de la transacción, segura con pooling de conexiones.
CREATE FUNCTION app_current_company_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO pv_app, pv_service;
GRANT EXECUTE ON FUNCTION app_current_company_id() TO pv_app, pv_service;

-- ---------------------------------------------------------------------------
-- Permisos de tabla de pv_app
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  invitations, clients, solar_plants, inverter_credentials, telemetry_readings,
  plant_weather_hourly, plant_daily_metrics, plant_events, alerts, maintenance_tickets,
  notifications, monthly_reports, ai_conversations, ai_messages, ai_usage_monthly,
  refresh_tokens
  TO pv_app;
-- La empresa no se crea ni se borra desde la aplicación (solo superadmin vía pv_service).
GRANT SELECT, UPDATE ON companies TO pv_app;
-- Los usuarios se desactivan, no se borran.
GRANT SELECT, INSERT, UPDATE ON users, job_runs TO pv_app;
-- La auditoría es de solo anexado.
GRANT SELECT, INSERT ON audit_log TO pv_app;

-- ---------------------------------------------------------------------------
-- Permisos de tabla de pv_service
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON companies, users, invitations, job_runs TO pv_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO pv_service;
GRANT SELECT, INSERT ON audit_log TO pv_service;
-- Conteo de plantas y uso de IA para el panel de superadmin (specs/02: sin datos operativos).
GRANT SELECT ON solar_plants, ai_usage_monthly TO pv_service;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- FORCE: también aplica al dueño de la tabla, así una DATABASE_URL mal configurada con el rol
-- dueño falla cerrado (0 filas) en lugar de exponer datos de todas las empresas.
-- refresh_tokens no tiene company_id y no lleva RLS (se accede por hash del token).

DO $$
DECLARE
  t text;
BEGIN
  -- Tablas con company_id (NOT NULL, o nullable en users, audit_log y job_runs: las filas de
  -- plataforma con company_id NULL nunca son visibles para pv_app).
  FOREACH t IN ARRAY ARRAY[
    'invitations', 'clients', 'solar_plants', 'inverter_credentials', 'telemetry_readings',
    'plant_weather_hourly', 'plant_daily_metrics', 'plant_events', 'alerts',
    'maintenance_tickets', 'notifications', 'monthly_reports', 'ai_conversations',
    'ai_messages', 'ai_usage_monthly', 'users', 'audit_log', 'job_runs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO pv_app '
      'USING (company_id = app_current_company_id()) '
      'WITH CHECK (company_id = app_current_company_id())',
      t
    );
  END LOOP;
END
$$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies TO pv_app
  USING (id = app_current_company_id())
  WITH CHECK (id = app_current_company_id());

-- pv_service: acceso completo a las tablas de plataforma; lectura de plantas y uso de IA.
CREATE POLICY platform_access ON companies TO pv_service USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON users TO pv_service USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON invitations TO pv_service USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON audit_log TO pv_service USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON job_runs TO pv_service USING (true) WITH CHECK (true);
CREATE POLICY platform_read ON solar_plants FOR SELECT TO pv_service USING (true);
CREATE POLICY platform_read ON ai_usage_monthly FOR SELECT TO pv_service USING (true);

-- Índices y restricciones que Prisma no expresa (ver specs/03-modelo-de-datos.md).
-- Los índices BRIN sobre ts ya los crea la migración init (@@index type: Brin).

-- Máximo una alerta abierta por (plant_id, type) (specs/03 §alerts, specs/06 §4).
CREATE UNIQUE INDEX "alerts_one_open_per_plant_type"
  ON "alerts" ("plant_id", "type")
  WHERE "status" IN ('open', 'acknowledged');

-- Alertas descartadas requieren motivo (specs/06 §4).
ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_dismiss_reason_required"
  CHECK ("status" <> 'dismissed' OR coalesce(length(trim("dismiss_reason")), 0) > 0);

-- Usuarios: correo en minúsculas; company_id null solo para superadmin.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_company_required_unless_superadmin"
  CHECK (("role" = 'superadmin') = ("company_id" IS NULL));

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "invitations_role_not_superadmin" CHECK ("role" <> 'superadmin');

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_brand_color_hex" CHECK ("brand_color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "companies_ai_budget_non_negative" CHECK ("ai_monthly_token_budget" >= 0);

-- Inventario.
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_postal_code_5_digits" CHECK ("postal_code" ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "clients_lat_range" CHECK ("lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "clients_lon_range" CHECK ("lon" BETWEEN -180 AND 180);

ALTER TABLE "solar_plants"
  ADD CONSTRAINT "solar_plants_capacity_positive" CHECK ("capacity_kwp" > 0),
  ADD CONSTRAINT "solar_plants_tilt_range" CHECK ("tilt_deg" BETWEEN 0 AND 90),
  ADD CONSTRAINT "solar_plants_azimuth_range" CHECK ("azimuth_deg" BETWEEN 0 AND 360),
  ADD CONSTRAINT "solar_plants_gamma_negative" CHECK ("gamma_pct_per_c" < 0),
  ADD CONSTRAINT "solar_plants_postal_code_5_digits" CHECK ("postal_code" ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "solar_plants_lat_range" CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "solar_plants_lon_range" CHECK ("lon" IS NULL OR "lon" BETWEEN -180 AND 180),
  ADD CONSTRAINT "solar_plants_panel_count_positive" CHECK ("panel_count" IS NULL OR "panel_count" > 0),
  ADD CONSTRAINT "solar_plants_simulation_profile_only_simulator"
  CHECK ("simulation_profile" IS NULL OR "inverter_brand" = 'simulator');

ALTER TABLE "inverter_credentials"
  ADD CONSTRAINT "inverter_credentials_key_version_positive" CHECK ("key_version" >= 1);

-- Periodos YYYY-MM.
ALTER TABLE "monthly_reports"
  ADD CONSTRAINT "monthly_reports_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE "ai_usage_monthly"
  ADD CONSTRAINT "ai_usage_monthly_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Búsquedas de alertas abiertas por empresa (bandeja y tablero).
CREATE INDEX "alerts_open_by_company"
  ON "alerts" ("company_id", "detected_at" DESC)
  WHERE "status" IN ('open', 'acknowledged');

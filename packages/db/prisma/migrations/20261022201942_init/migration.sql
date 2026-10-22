-- CreateEnum
CREATE TYPE "company_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('superadmin', 'company_admin', 'operator', 'technician');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "job_run_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "inverter_brand" AS ENUM ('simulator', 'goodwe', 'huawei', 'fronius', 'enphase', 'other');

-- CreateEnum
CREATE TYPE "plant_status" AS ENUM ('active', 'paused', 'decommissioned');

-- CreateEnum
CREATE TYPE "baseline_source" AS ENUM ('own', 'neighbors', 'default');

-- CreateEnum
CREATE TYPE "invalid_day_reason" AS ENUM ('low_irradiation', 'incomplete_data', 'offline', 'no_weather');

-- CreateEnum
CREATE TYPE "prediction_confidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "plant_daily_status" AS ENUM ('ok', 'warning', 'critical', 'offline', 'no_data');

-- CreateEnum
CREATE TYPE "plant_event_type" AS ENUM ('cleaning', 'rain_cleaning', 'repair', 'inverter_replaced', 'commissioning', 'note');

-- CreateEnum
CREATE TYPE "plant_event_source" AS ENUM ('ticket', 'auto', 'manual');

-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('offline', 'sudden_drop', 'soiling', 'cleaning_due_soon');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "alert_resolution" AS ENUM ('auto', 'ticket', 'manual');

-- CreateEnum
CREATE TYPE "ai_status" AS ENUM ('pending', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ticket_type" AS ENUM ('cleaning', 'inspection', 'repair', 'other');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('pending', 'scheduled', 'in_progress', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('pending', 'generated', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "narrative_source" AS ENUM ('ai', 'template');

-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "ai_feature" AS ENUM ('chat', 'alert_explanation', 'report_narrative');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "brand_color" TEXT NOT NULL DEFAULT '#F59E0B',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mazatlan',
    "status" "company_status" NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "ai_monthly_token_budget" INTEGER NOT NULL DEFAULT 2000000,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_name" TEXT NOT NULL,
    "company_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "status" "job_run_status" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "colonia" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Culiacán',
    "state" TEXT NOT NULL DEFAULT 'Sinaloa',
    "lat" DECIMAL(9,6) NOT NULL,
    "lon" DECIMAL(9,6) NOT NULL,
    "cfe_tariff" TEXT,
    "avg_monthly_kwh" DECIMAL(12,2),
    "avg_monthly_bill_mxn" DECIMAL(12,2),
    "tariff_mxn_per_kwh" DECIMAL(10,4),
    "report_email" TEXT,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_plants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity_kwp" DECIMAL(8,2) NOT NULL,
    "tilt_deg" DECIMAL(5,2) NOT NULL,
    "azimuth_deg" DECIMAL(5,2) NOT NULL,
    "noct_c" DECIMAL(5,2) NOT NULL DEFAULT 45,
    "gamma_pct_per_c" DECIMAL(6,4) NOT NULL DEFAULT -0.40,
    "panel_model" TEXT,
    "panel_count" INTEGER,
    "inverter_brand" "inverter_brand" NOT NULL,
    "inverter_model" TEXT,
    "inverter_serial" TEXT,
    "commissioning_date" DATE,
    "lat" DECIMAL(9,6),
    "lon" DECIMAL(9,6),
    "postal_code" TEXT NOT NULL,
    "colonia" TEXT NOT NULL,
    "status" "plant_status" NOT NULL DEFAULT 'active',
    "last_reading_at" TIMESTAMPTZ,
    "last_power_kw" DECIMAL(14,4),
    "simulation_profile" JSONB,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inverter_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "provider" "inverter_brand" NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last_test_at" TIMESTAMPTZ,
    "last_test_ok" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inverter_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_readings" (
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL,
    "power_kw" DECIMAL(14,4) NOT NULL,
    "energy_kwh" DECIMAL(14,4) NOT NULL,
    "energy_today_kwh" DECIMAL(14,4),
    "inverter_temp_c" DECIMAL(6,2),
    "status_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_readings_pkey" PRIMARY KEY ("plant_id","ts")
);

-- CreateTable
CREATE TABLE "plant_weather_hourly" (
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL,
    "poa_wm2" DECIMAL(8,2) NOT NULL,
    "ghi_wm2" DECIMAL(8,2) NOT NULL,
    "temp_amb_c" DECIMAL(6,2) NOT NULL,
    "cloud_cover_pct" DECIMAL(5,2) NOT NULL,
    "precipitation_mm" DECIMAL(7,2) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_weather_hourly_pkey" PRIMARY KEY ("plant_id","ts")
);

-- CreateTable
CREATE TABLE "plant_daily_metrics" (
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "client_id" UUID NOT NULL,
    "postal_code" TEXT NOT NULL,
    "colonia" TEXT NOT NULL,
    "energy_kwh" DECIMAL(14,4) NOT NULL,
    "irradiation_poa_kwh_m2" DECIMAL(8,4) NOT NULL,
    "expected_stc_kwh" DECIMAL(14,4) NOT NULL,
    "expected_temp_kwh" DECIMAL(14,4) NOT NULL,
    "specific_yield_kwh_kwp" DECIMAL(10,4) NOT NULL,
    "pr" DECIMAL(8,5),
    "pr_temp" DECIMAL(8,5),
    "pr_baseline" DECIMAL(8,5),
    "baseline_source" "baseline_source",
    "deviation_pct" DECIMAL(8,3),
    "neighbor_index" DECIMAL(8,5),
    "neighbor_count" INTEGER NOT NULL DEFAULT 0,
    "temp_amb_max_c" DECIMAL(6,2),
    "t_cell_max_c" DECIMAL(6,2),
    "cloud_cover_avg_pct" DECIMAL(5,2),
    "rain_mm" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "data_completeness_pct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "is_valid_day" BOOLEAN NOT NULL DEFAULT false,
    "invalid_reason" "invalid_day_reason",
    "soiling_slope_pct_per_day" DECIMAL(8,4),
    "days_to_cleaning" INTEGER,
    "prediction_confidence" "prediction_confidence",
    "zone_event" BOOLEAN NOT NULL DEFAULT false,
    "status" "plant_daily_status" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_daily_metrics_pkey" PRIMARY KEY ("plant_id","date")
);

-- CreateTable
CREATE TABLE "plant_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "type" "plant_event_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "source" "plant_event_source" NOT NULL,
    "ticket_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "type" "alert_type" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'open',
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolution" "alert_resolution",
    "dismiss_reason" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "ai_explanation" JSONB,
    "ai_status" "ai_status" NOT NULL DEFAULT 'pending',
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "alert_id" UUID,
    "type" "ticket_type" NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'pending',
    "priority" "ticket_priority" NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigned_to" UUID,
    "scheduled_for" DATE,
    "resolved_at" TIMESTAMPTZ,
    "resolution_notes" TEXT,
    "cleaning_performed" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL DEFAULT 'email',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "related_type" TEXT,
    "related_id" UUID,
    "sent_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'pending',
    "facts" JSONB,
    "narrative" TEXT,
    "narrative_source" "narrative_source",
    "storage_key" TEXT,
    "sent_to" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "content" JSONB NOT NULL,
    "tool_name" TEXT,
    "tool_input" JSONB,
    "tool_output_summary" JSONB,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_monthly" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "feature" "ai_feature" NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_monthly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_company_id_idx" ON "users"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_company_id_email_idx" ON "invitations"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_key" ON "refresh_tokens"("replaced_by");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs"("job_name", "started_at" DESC);

-- CreateIndex
CREATE INDEX "job_runs_company_id_started_at_idx" ON "job_runs"("company_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "clients_company_id_postal_code_idx" ON "clients"("company_id", "postal_code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_id_company_id_key" ON "clients"("id", "company_id");

-- CreateIndex
CREATE INDEX "solar_plants_company_id_postal_code_idx" ON "solar_plants"("company_id", "postal_code");

-- CreateIndex
CREATE INDEX "solar_plants_company_id_status_idx" ON "solar_plants"("company_id", "status");

-- CreateIndex
CREATE INDEX "solar_plants_client_id_idx" ON "solar_plants"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "solar_plants_id_company_id_key" ON "solar_plants"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "inverter_credentials_plant_id_key" ON "inverter_credentials"("plant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inverter_credentials_plant_id_company_id_key" ON "inverter_credentials"("plant_id", "company_id");

-- CreateIndex
CREATE INDEX "telemetry_readings_ts_idx" ON "telemetry_readings" USING BRIN ("ts");

-- CreateIndex
CREATE INDEX "plant_weather_hourly_ts_idx" ON "plant_weather_hourly" USING BRIN ("ts");

-- CreateIndex
CREATE INDEX "plant_daily_metrics_company_id_date_idx" ON "plant_daily_metrics"("company_id", "date");

-- CreateIndex
CREATE INDEX "plant_daily_metrics_company_id_date_postal_code_idx" ON "plant_daily_metrics"("company_id", "date", "postal_code");

-- CreateIndex
CREATE INDEX "plant_events_plant_id_occurred_at_idx" ON "plant_events"("plant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "plant_events_company_id_occurred_at_idx" ON "plant_events"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "alerts_company_id_status_idx" ON "alerts"("company_id", "status");

-- CreateIndex
CREATE INDEX "alerts_plant_id_type_idx" ON "alerts"("plant_id", "type");

-- CreateIndex
CREATE INDEX "maintenance_tickets_company_id_status_idx" ON "maintenance_tickets"("company_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_tickets_assigned_to_status_idx" ON "maintenance_tickets"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "maintenance_tickets_plant_id_idx" ON "maintenance_tickets"("plant_id");

-- CreateIndex
CREATE INDEX "notifications_company_id_status_idx" ON "notifications"("company_id", "status");

-- CreateIndex
CREATE INDEX "notifications_related_type_related_id_idx" ON "notifications"("related_type", "related_id");

-- CreateIndex
CREATE INDEX "monthly_reports_company_id_period_idx" ON "monthly_reports"("company_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reports_client_id_period_key" ON "monthly_reports"("client_id", "period");

-- CreateIndex
CREATE INDEX "ai_conversations_company_id_user_id_last_message_at_idx" ON "ai_conversations"("company_id", "user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_id_company_id_key" ON "ai_conversations"("id", "company_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_monthly_company_id_period_feature_key" ON "ai_usage_monthly"("company_id", "period", "feature");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_plants" ADD CONSTRAINT "solar_plants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_plants" ADD CONSTRAINT "solar_plants_client_id_company_id_fkey" FOREIGN KEY ("client_id", "company_id") REFERENCES "clients"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inverter_credentials" ADD CONSTRAINT "inverter_credentials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inverter_credentials" ADD CONSTRAINT "inverter_credentials_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_weather_hourly" ADD CONSTRAINT "plant_weather_hourly_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_weather_hourly" ADD CONSTRAINT "plant_weather_hourly_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_daily_metrics" ADD CONSTRAINT "plant_daily_metrics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_daily_metrics" ADD CONSTRAINT "plant_daily_metrics_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_daily_metrics" ADD CONSTRAINT "plant_daily_metrics_client_id_company_id_fkey" FOREIGN KEY ("client_id", "company_id") REFERENCES "clients"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_events" ADD CONSTRAINT "plant_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_events" ADD CONSTRAINT "plant_events_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_events" ADD CONSTRAINT "plant_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "maintenance_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "maintenance_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_plant_id_company_id_fkey" FOREIGN KEY ("plant_id", "company_id") REFERENCES "solar_plants"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_client_id_company_id_fkey" FOREIGN KEY ("client_id", "company_id") REFERENCES "clients"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_company_id_fkey" FOREIGN KEY ("conversation_id", "company_id") REFERENCES "ai_conversations"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

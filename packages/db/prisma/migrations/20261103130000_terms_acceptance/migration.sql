-- Aceptación de los términos de uso y el aviso de privacidad por persona (docs/plan-lanzamiento.md
-- 3.5): versión aceptada y fecha. El historial (con IP) queda en audit_log ('legal.accepted').
ALTER TABLE "users" ADD COLUMN "terms_version" TEXT;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ;

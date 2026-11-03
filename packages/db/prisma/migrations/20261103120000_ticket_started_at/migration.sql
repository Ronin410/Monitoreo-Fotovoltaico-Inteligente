-- Momento en que el ticket se inició (primer paso a in_progress), para medir el tiempo de trabajo
-- hasta resolverlo (specs/06 §5, specs/PREGUNTAS.md #204). Los tickets anteriores quedan sin dato.
ALTER TABLE "maintenance_tickets" ADD COLUMN "started_at" TIMESTAMPTZ;
CREATE INDEX "maintenance_tickets_company_id_resolved_at_idx"
  ON "maintenance_tickets" ("company_id", "resolved_at");

-- Plantas cuyo inversor puede limitar la producción a propósito (specs/06 §2.4): con batería o con
-- límite de inyección a la red. Sus alertas de rendimiento se omiten para no dar falsas alarmas.
ALTER TABLE "solar_plants"
  ADD COLUMN "has_battery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "export_limited" BOOLEAN NOT NULL DEFAULT false;

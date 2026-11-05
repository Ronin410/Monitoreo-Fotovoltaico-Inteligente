-- Tipo de instalación (segmento) de cada planta: casa, negocio o industria (specs/03). Las plantas
-- que ya existen quedan como residenciales; la instaladora las corrige en el formulario.
CREATE TYPE "installation_type" AS ENUM ('residential', 'commercial', 'industrial');

ALTER TABLE "solar_plants"
  ADD COLUMN "installation_type" "installation_type" NOT NULL DEFAULT 'residential';

CREATE INDEX "solar_plants_company_id_installation_type_idx"
  ON "solar_plants"("company_id", "installation_type");

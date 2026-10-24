-- Marcas que usa la empresa piloto (specs/PREGUNTAS.md #200). Los adaptadores siguen sin
-- implementar hasta tener la documentación oficial de cada fabricante.
ALTER TYPE "inverter_brand" ADD VALUE IF NOT EXISTS 'growatt' AFTER 'goodwe';
ALTER TYPE "inverter_brand" ADD VALUE IF NOT EXISTS 'victron' AFTER 'growatt';

-- AlterEnum
ALTER TYPE "job_run_status" ADD VALUE 'skipped';

-- Colas de pg-boss (specs/01 §Colas y jobs). El rol de plataforma puede crear tablas aquí: el
-- worker y la api encolan con SERVICE_DATABASE_URL y pg-boss instala sus tablas ahí, sin
-- necesitar el rol dueño. Las colas solo guardan ids y company_id, nunca datos operativos.
CREATE SCHEMA IF NOT EXISTS pgboss;
GRANT USAGE, CREATE ON SCHEMA pgboss TO pv_service;

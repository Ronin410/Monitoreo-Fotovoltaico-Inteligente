-- Borrado definitivo de una empresa al terminar el contrato (docs/plan-lanzamiento.md 3.7).
--
-- Los datos operativos los borra el worker con pv_app dentro de withTenant (RLS los limita a esa
-- empresa). Las tablas de plataforma (empresa, usuarios, invitaciones, job_runs y auditoría) las
-- borra pv_service, que hasta ahora no tenía DELETE: la auditoría era de solo anexado.
--
-- Para no abrir más de lo necesario, una política RESTRICTIVA limita ese DELETE a filas de una
-- empresa **suspendida**. Las de empresas activas y las de plataforma (company_id NULL) siguen
-- sin poder borrarse. Las acciones ON DELETE de las llaves foráneas no pasan por RLS.

GRANT DELETE ON companies, users, invitations, job_runs, audit_log TO pv_service;

CREATE POLICY purge_suspended_only ON companies AS RESTRICTIVE FOR DELETE TO pv_service
  USING (status = 'suspended');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'invitations', 'job_runs', 'audit_log']
  LOOP
    EXECUTE format(
      'CREATE POLICY purge_suspended_only ON %I AS RESTRICTIVE FOR DELETE TO pv_service '
      'USING (company_id IN (SELECT id FROM companies WHERE status = ''suspended''))',
      t
    );
  END LOOP;
END
$$;

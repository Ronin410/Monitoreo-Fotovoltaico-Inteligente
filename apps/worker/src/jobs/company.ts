import { companyExport, companyPurge } from '@pv/adapters';
import { runCompanyExport } from '../company-export.js';
import { purgeCompany } from '../company-purge.js';
import { registerJob } from '../runtime.js';

// Exportación y borrado definitivo de los datos de una empresa (docs/plan-lanzamiento.md 3.7).

export const companyExportJob = registerJob(companyExport, async (payload, ctx) =>
  runCompanyExport(ctx, payload.company_id),
);

export const companyPurgeJob = registerJob(companyPurge, async (payload, ctx) => {
  const result = await purgeCompany(ctx, payload.company_id, payload.requested_by);
  return result
    ? { company_id: payload.company_id, files: result.files, counts: result.counts }
    : { company_id: payload.company_id, already_purged: true };
});

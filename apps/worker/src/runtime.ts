import type {
  CredentialCipher,
  InverterAdapterRegistry,
  JobDefinition,
  JobQueue,
  WeatherProvider,
} from '@pv/adapters';
import type { Prisma, PrismaClient } from '@pv/db';
import type { Logger } from 'pino';
import { z } from 'zod';

// Ejecución de jobs (specs/01 §Jobs): cada job valida su payload, corre en el contexto de su
// empresa, registra cada intento en job_runs y, si falla, pg-boss lo reintenta con backoff.

export type JobContext = {
  /** Empresa del job (de su payload). null en jobs de plataforma. */
  companyId: string | null;
  /** Conexión pv_app: todo acceso a datos de la empresa va con withTenant(db, companyId). */
  db: PrismaClient;
  /** Conexión pv_service: solo operaciones de plataforma (listar empresas, encolar). */
  serviceDb: PrismaClient;
  queue: JobQueue;
  /** Proveedor de clima (WEATHER_PROVIDER). */
  weather: WeatherProvider;
  /** Descifra credenciales de inversor en memoria (solo el worker, specs/02). */
  cipher: CredentialCipher;
  /** Adaptadores de inversor para una empresa (el simulador lee sus datos de esa empresa). */
  adapters: (companyId: string) => InverterAdapterRegistry;
  log: Logger;
  now: () => Date;
  /** 0 en el primer intento. */
  attempt: number;
};

/** Estadísticas que el job devuelve y se guardan en job_runs.stats. */
export type JobStats = Prisma.InputJsonObject;

export type JobHandler<P extends z.ZodType> = (
  payload: z.output<P>,
  ctx: JobContext,
) => Promise<JobStats | undefined>;

export type RegisteredJob = {
  definition: JobDefinition;
  handler: JobHandler<z.ZodType>;
};

export function registerJob<P extends z.ZodType>(
  definition: JobDefinition<P>,
  handler: JobHandler<P>,
): RegisteredJob {
  return { definition, handler: handler as JobHandler<z.ZodType> };
}

export type RuntimeDeps = Omit<JobContext, 'companyId' | 'attempt' | 'log'> & { logger: Logger };

export type RunOutcome = 'succeeded' | 'failed' | 'skipped' | 'invalid';

const MAX_ERROR_LENGTH = 500;

/** Mensaje para job_runs: tipo y mensaje, recortado. Los jobs no deben poner secretos en errores. */
function errorText(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Ejecuta un intento. Lanza el error del job para que pg-boss reintente; un payload inválido o
 * una empresa suspendida no se reintentan.
 */
export async function runJob(
  job: RegisteredJob,
  rawPayload: unknown,
  attempt: number,
  deps: RuntimeDeps,
): Promise<RunOutcome> {
  const { definition } = job;
  const log = deps.logger.child({ job: definition.name, attempt });
  const startedAt = deps.now();

  const parsed = definition.payload.safeParse(rawPayload ?? {});
  const companyId =
    definition.scope === 'company'
      ? (z.object({ company_id: z.uuid() }).safeParse(rawPayload).data?.company_id ?? null)
      : null;
  const record = (data: {
    status: 'running' | 'succeeded' | 'failed' | 'skipped';
    error?: string;
    stats?: JobStats;
  }) =>
    deps.serviceDb.jobRun.create({
      data: {
        jobName: definition.name,
        companyId,
        startedAt,
        finishedAt: data.status === 'running' ? null : deps.now(),
        status: data.status,
        error: data.error ?? null,
        stats: { attempt, ...data.stats },
      },
    });

  if (!parsed.success || (definition.scope === 'company' && !companyId)) {
    log.error({ issues: parsed.error?.issues.map((i) => i.path.join('.')) }, 'payload inválido');
    await record({ status: 'failed', error: 'invalid_payload' });
    return 'invalid';
  }

  if (companyId) {
    const company = await deps.serviceDb.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (company?.status !== 'active') {
      // Empresa suspendida (o eliminada): sus jobs se pausan.
      await record({
        status: 'skipped',
        stats: { reason: company ? 'company_suspended' : 'company_not_found' },
      });
      log.info({ company_id: companyId }, 'job omitido: empresa no activa');
      return 'skipped';
    }
  }

  const run = await record({ status: 'running' });
  try {
    const stats = await job.handler(parsed.data, {
      ...deps,
      companyId,
      attempt,
      log: log.child({ company_id: companyId, job_run_id: run.id }),
    });
    await deps.serviceDb.jobRun.update({
      where: { id: run.id },
      data: { status: 'succeeded', finishedAt: deps.now(), stats: { attempt, ...(stats ?? {}) } },
    });
    return 'succeeded';
  } catch (err) {
    await deps.serviceDb.jobRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: deps.now(), error: errorText(err) },
    });
    log.error({ company_id: companyId, error_type: (err as Error).name }, 'job falló');
    throw err;
  }
}

/** Crea las colas, registra los cron y empieza a atender los jobs. */
export async function startJobs(jobs: RegisteredJob[], deps: RuntimeDeps): Promise<void> {
  for (const job of jobs) {
    await deps.queue.ensureQueue(job.definition);
    await deps.queue.ensureSchedule(job.definition);
    await deps.queue.work(job.definition, async (pgJob) => {
      const attempt = (pgJob as { retryCount?: number }).retryCount ?? 0;
      await runJob(job, pgJob.data, attempt, deps);
    });
  }
}

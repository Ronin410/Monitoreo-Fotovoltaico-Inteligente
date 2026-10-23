import { PgBoss, type Job } from 'pg-boss';
import type { z } from 'zod';
import type { JobDefinition } from './definition.js';
import type { JobEnqueuer } from './enqueuer.js';

export const QUEUE_SCHEMA = 'pgboss';

const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const DEFAULT_EXPIRE_SECONDS = 15 * 60;

export type EnqueueOptions = {
  startAfter?: Date | number;
};

export type QueueOptions = {
  /** Segundos entre consultas de trabajo nuevo (por defecto 2). */
  pollingIntervalSeconds?: number;
  /** Desactiva cron y mantenimiento (pruebas que solo encolan). */
  supervise?: boolean;
};

/**
 * Colas sobre PostgreSQL con pg-boss (specs/01: sustituye a Redis en v1). Se conecta con el rol
 * de plataforma (SERVICE_DATABASE_URL), dueño de las tablas del esquema pgboss.
 */
export class JobQueue implements JobEnqueuer {
  private constructor(
    readonly boss: PgBoss,
    private readonly options: QueueOptions,
  ) {}

  static async start(connectionString: string, options: QueueOptions = {}): Promise<JobQueue> {
    const boss = new PgBoss({
      connectionString,
      schema: QUEUE_SCHEMA,
      // Las tablas quedan a nombre del rol de grupo pv_service, no del usuario de conexión:
      // así se puede rotar el usuario sin perder acceso a las colas.
      options: '-c role=pv_service',
      // El esquema lo crea la migración; el rol de plataforma no puede crear esquemas.
      createSchema: false,
      supervise: options.supervise ?? true,
      schedule: options.supervise ?? true,
    });
    await boss.start();
    return new JobQueue(boss, options);
  }

  /** Crea o actualiza la cola con la política de reintentos del job. */
  async ensureQueue(definition: JobDefinition): Promise<void> {
    const queue = {
      retryLimit: definition.retryLimit ?? DEFAULT_RETRY_LIMIT,
      retryDelay: definition.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
      retryBackoff: true,
      expireInSeconds: definition.expireInSeconds ?? DEFAULT_EXPIRE_SECONDS,
    };
    if (await this.boss.getQueue(definition.name)) {
      await this.boss.updateQueue(definition.name, queue);
    } else {
      await this.boss.createQueue(definition.name, {
        ...queue,
        // Un job pendiente o activo por singletonKey (idempotencia al encolar).
        policy: definition.singletonKey ? 'exclusive' : 'standard',
      });
    }
  }

  /** Encola un job validando su payload. Devuelve null si ya había uno igual pendiente. */
  async enqueue<P extends z.ZodType>(
    definition: JobDefinition<P>,
    payload: z.input<P>,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    const data = definition.payload.parse(payload) as z.output<P>;
    const singletonKey = definition.singletonKey?.(data);
    return this.boss.send(definition.name, data as object, {
      ...(singletonKey ? { singletonKey } : {}),
      ...(options.startAfter
        ? {
            startAfter:
              options.startAfter instanceof Date
                ? options.startAfter
                : new Date(options.startAfter),
          }
        : {}),
    });
  }

  /** Registra el cron del job (si lo tiene). */
  async ensureSchedule(definition: JobDefinition): Promise<void> {
    if (!definition.schedule) return;
    await this.boss.schedule(
      definition.name,
      definition.schedule.cron,
      {},
      {
        tz: definition.schedule.tz ?? 'UTC',
      },
    );
  }

  /** Atiende la cola, con `concurrency` jobs en paralelo (por defecto 1). */
  async work(
    definition: JobDefinition,
    handler: (job: Job<unknown>) => Promise<void>,
  ): Promise<string> {
    return this.boss.work<unknown>(
      definition.name,
      {
        pollingIntervalSeconds: this.options.pollingIntervalSeconds ?? 2,
        localConcurrency: definition.concurrency ?? 1,
      },
      async ([job]) => {
        if (job) await handler(job);
      },
    );
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }
}

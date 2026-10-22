import type { z } from 'zod';
import type { JobDefinition } from './definition.js';
import type { EnqueueOptions } from './queue.js';

/** Lo que necesita quien solo encola (la api). JobQueue lo implementa. */
export interface JobEnqueuer {
  enqueue<P extends z.ZodType>(
    definition: JobDefinition<P>,
    payload: z.input<P>,
    options?: EnqueueOptions,
  ): Promise<string | null>;
}

/** Registra lo encolado sin base de datos. Solo para pruebas. */
export class MemoryJobEnqueuer implements JobEnqueuer {
  readonly jobs: { name: string; payload: unknown }[] = [];

  async enqueue<P extends z.ZodType>(definition: JobDefinition<P>, payload: z.input<P>) {
    const data = definition.payload.parse(payload);
    this.jobs.push({ name: definition.name, payload: data });
    return `memoria-${this.jobs.length}`;
  }
}

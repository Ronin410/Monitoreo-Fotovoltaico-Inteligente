import { z } from 'zod';

// Variables de entorno de specs/01-arquitectura.md, validadas al arrancar.
// Los mensajes de error nunca incluyen el valor de la variable (pueden ser secretos).

const MIN_SECRET_BYTES = 32;

const requiredString = z.string({ error: 'es obligatoria' }).trim().min(1, 'es obligatoria');
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));
const url = requiredString.pipe(z.url({ error: 'debe ser una URL válida' }));

const secret = requiredString.refine((v) => Buffer.byteLength(v, 'utf8') >= MIN_SECRET_BYTES, {
  error: `debe tener al menos ${MIN_SECRET_BYTES} bytes`,
});

const aesKey = requiredString.refine(
  (v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32,
  { error: 'debe ser una llave de 32 bytes codificada en base64' },
);

const postgresUrl = requiredString.refine((v) => /^postgres(ql)?:\/\//.test(v), {
  error: 'debe ser una URL de PostgreSQL (postgres://…)',
});

const boolean = z
  .enum(['true', 'false'], { error: 'debe ser "true" o "false"' })
  .transform((v) => v === 'true');

const timezone = z.string().refine(
  (v) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'debe ser una zona horaria IANA válida (por ejemplo America/Mazatlan)' },
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().optional(),

    // Usuario miembro de pv_app (ver packages/db/README.md).
    DATABASE_URL: postgresUrl,
    // Usuario miembro de pv_service: login, superadmin y jobs globales (specs/02).
    SERVICE_DATABASE_URL: postgresUrl,
    APP_URL: url,
    API_URL: url,

    JWT_SECRET: secret,
    REFRESH_TOKEN_SECRET: secret,
    CREDENTIALS_ENC_KEY: aesKey,
    CREDENTIALS_KEY_VERSION: z.coerce.number().int().min(1).default(1),

    LLM_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
    ANTHROPIC_API_KEY: optionalString,
    LLM_MODEL_CHAT: requiredString.default('claude-sonnet-5-5'),
    LLM_MODEL_FAST: requiredString.default('claude-haiku-5-5'),

    WEATHER_PROVIDER: z.enum(['open-meteo', 'synthetic']).default('open-meteo'),
    WEATHER_API_KEY: optionalString,

    EMAIL_PROVIDER: z.enum(['resend', 'smtp'], { error: 'es obligatoria: "resend" o "smtp"' }),
    EMAIL_FROM: requiredString,
    RESEND_API_KEY: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_SECURE: boolean.default(false),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: requiredString.default('./storage'),
    S3_ENDPOINT: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY: optionalString,
    S3_SECRET_KEY: optionalString,

    SIMULATOR_ENABLED: boolean.default(false),
    DEFAULT_TIMEZONE: timezone.default('America/Mazatlan'),
  })
  .superRefine((env, ctx) => {
    const requireWhen = (cond: boolean, key: keyof typeof env, why: string) => {
      if (cond && (env[key] === undefined || env[key] === '')) {
        ctx.addIssue({ code: 'custom', path: [key], message: `es obligatoria cuando ${why}` });
      }
    };
    requireWhen(env.LLM_PROVIDER === 'anthropic', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER=anthropic');
    requireWhen(env.EMAIL_PROVIDER === 'resend', 'RESEND_API_KEY', 'EMAIL_PROVIDER=resend');
    requireWhen(env.EMAIL_PROVIDER === 'smtp', 'SMTP_HOST', 'EMAIL_PROVIDER=smtp');
    requireWhen(env.EMAIL_PROVIDER === 'smtp', 'SMTP_PORT', 'EMAIL_PROVIDER=smtp');
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      requireWhen(env.STORAGE_PROVIDER === 's3', key, 'STORAGE_PROVIDER=s3');
    }
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'no puede ser "mock" en producción',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly problems: { variable: string; message: string }[]) {
    super(
      [
        'Configuración inválida: revisa las variables de entorno (ver .env.example).',
        ...problems.map((p) => `  - ${p.variable}: ${p.message}`),
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

/** Valida las variables de entorno. Lanza EnvValidationError con la lista de problemas. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Una variable definida pero vacía se trata como ausente, para que aplique su valor por defecto.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new EnvValidationError(
    result.error.issues.map((issue) => ({
      variable: issue.path.join('.') || '(raíz)',
      message: issue.message,
    })),
  );
}

/** Para los puntos de entrada: valida o termina el proceso con un mensaje claro. */
export function loadEnvOrExit(source: Record<string, string | undefined> = process.env): Env {
  try {
    return loadEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

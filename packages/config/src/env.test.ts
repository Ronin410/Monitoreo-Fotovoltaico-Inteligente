import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './index.js';

const KEY_32_BYTES_B64 = Buffer.alloc(32, 7).toString('base64');

const validEnv = {
  DATABASE_URL: 'postgres://pv_app:pw@localhost:5432/pv',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  JWT_SECRET: 'j'.repeat(32),
  REFRESH_TOKEN_SECRET: 'r'.repeat(32),
  CREDENTIALS_ENC_KEY: KEY_32_BYTES_B64,
  ANTHROPIC_API_KEY: 'sk-test',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'PV-IoT <no-reply@example.com>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
};

function problemsOf(source: Record<string, string | undefined>) {
  try {
    loadEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.problems.map((p) => p.variable);
    throw err;
  }
  return [];
}

describe('loadEnv', () => {
  it('acepta una configuración válida y aplica valores por defecto', () => {
    const env = loadEnv(validEnv);
    expect(env.CREDENTIALS_KEY_VERSION).toBe(1);
    expect(env.LLM_PROVIDER).toBe('anthropic');
    expect(env.LLM_MODEL_CHAT).toBe('claude-sonnet-5-5');
    expect(env.LLM_MODEL_FAST).toBe('claude-haiku-5-5');
    expect(env.WEATHER_PROVIDER).toBe('open-meteo');
    expect(env.STORAGE_PROVIDER).toBe('local');
    expect(env.SIMULATOR_ENABLED).toBe(false);
    expect(env.DEFAULT_TIMEZONE).toBe('America/Mazatlan');
    expect(env.SMTP_PORT).toBe(1025);
  });

  it('falla con un mensaje claro que nombra la variable obligatoria faltante', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrowError(/DATABASE_URL: es obligatoria/);
  });

  it('reporta todas las variables faltantes a la vez', () => {
    expect(problemsOf({})).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'APP_URL',
        'API_URL',
        'JWT_SECRET',
        'REFRESH_TOKEN_SECRET',
        'CREDENTIALS_ENC_KEY',
        'EMAIL_PROVIDER',
        'EMAIL_FROM',
      ]),
    );
  });

  it('trata una variable vacía como ausente', () => {
    expect(problemsOf({ ...validEnv, JWT_SECRET: '' })).toEqual(['JWT_SECRET']);
  });

  it('exige secretos JWT de al menos 32 bytes', () => {
    expect(problemsOf({ ...validEnv, JWT_SECRET: 'corto' })).toEqual(['JWT_SECRET']);
  });

  it('exige una llave AES de exactamente 32 bytes en base64', () => {
    const key16 = Buffer.alloc(16).toString('base64');
    expect(problemsOf({ ...validEnv, CREDENTIALS_ENC_KEY: key16 })).toEqual([
      'CREDENTIALS_ENC_KEY',
    ]);
    expect(problemsOf({ ...validEnv, CREDENTIALS_ENC_KEY: 'no-es-base64!' })).toEqual([
      'CREDENTIALS_ENC_KEY',
    ]);
  });

  it('nunca incluye el valor de un secreto en el mensaje de error', () => {
    const leaked = 'secreto-muy-largo-que-no-debe-salir-en-logs-'.repeat(2);
    try {
      loadEnv({ ...validEnv, DATABASE_URL: `mysql://${leaked}`, JWT_SECRET: 'x' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(leaked);
    }
  });

  it('exige las variables del proveedor elegido', () => {
    expect(problemsOf({ ...validEnv, ANTHROPIC_API_KEY: undefined })).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
    expect(problemsOf({ ...validEnv, LLM_PROVIDER: 'mock', ANTHROPIC_API_KEY: undefined })).toEqual(
      [],
    );
    expect(problemsOf({ ...validEnv, EMAIL_PROVIDER: 'resend' })).toEqual(['RESEND_API_KEY']);
    expect(problemsOf({ ...validEnv, STORAGE_PROVIDER: 's3' })).toEqual([
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
    ]);
  });

  it('no permite el proveedor de IA simulado en producción', () => {
    expect(problemsOf({ ...validEnv, NODE_ENV: 'production', LLM_PROVIDER: 'mock' })).toEqual([
      'LLM_PROVIDER',
    ]);
  });

  it('valida booleanos y zona horaria', () => {
    expect(loadEnv({ ...validEnv, SIMULATOR_ENABLED: 'true' }).SIMULATOR_ENABLED).toBe(true);
    expect(problemsOf({ ...validEnv, SIMULATOR_ENABLED: 'si' })).toEqual(['SIMULATOR_ENABLED']);
    expect(problemsOf({ ...validEnv, DEFAULT_TIMEZONE: 'Culiacan/Centro' })).toEqual([
      'DEFAULT_TIMEZONE',
    ]);
  });
});

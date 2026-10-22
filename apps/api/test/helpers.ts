import { Writable } from 'node:stream';
import { MemoryEmailProvider } from '@pv/adapters';
import { loadEnv } from '@pv/config';
import { createPrismaClient, type PrismaClient, type UserRole } from '@pv/db';
import { testAppDatabaseUrl, testDatabaseUrl, testServiceDatabaseUrl } from '@pv/db/testing';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { createLogger } from '../src/http/logger.js';

export const TEST_ENV = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: testAppDatabaseUrl('api'),
  SERVICE_DATABASE_URL: testServiceDatabaseUrl('api'),
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  JWT_SECRET: 'jwt-secret-de-pruebas-con-mas-de-32-bytes',
  REFRESH_TOKEN_SECRET: 'refresh-secret-de-pruebas-con-mas-de-32-bytes',
  CREDENTIALS_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
  LLM_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'PV-IoT <no-reply@example.com>',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
});

/** Reloj controlable para probar expiraciones. */
export class TestClock {
  current = new Date('2026-10-22T18:00:00Z');
  now = () => this.current;
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export async function createTestContext() {
  const owner = createPrismaClient(testDatabaseUrl('api'));
  const db = createPrismaClient(TEST_ENV.DATABASE_URL);
  const serviceDb = createPrismaClient(TEST_ENV.SERVICE_DATABASE_URL);
  const email = new MemoryEmailProvider();
  const clock = new TestClock();
  const logLines: string[] = [];
  const logger = createLogger(
    'info',
    new Writable({
      write(chunk, _enc, cb) {
        logLines.push(String(chunk));
        cb();
      },
    }),
  );
  const app = createApp({ env: TEST_ENV, db, serviceDb, email, logger, now: clock.now });
  return {
    app,
    owner,
    db,
    serviceDb,
    email,
    clock,
    logLines,
    close: () => Promise.all([owner.$disconnect(), db.$disconnect(), serviceDb.$disconnect()]),
  };
}

let seq = 0;
const unique = () => `${Date.now()}-${++seq}`;

/** IP distinta por petición para que el límite por IP no interfiera entre pruebas. */
export const freshIp = () => `10.${seq % 250}.${Math.floor(Math.random() * 250)}.${++seq % 250}`;

export async function createCompany(
  owner: PrismaClient,
  over: { status?: 'active' | 'suspended'; name?: string } = {},
) {
  const tag = unique();
  return owner.company.create({
    data: { name: over.name ?? `Empresa ${tag}`, slug: `emp-${tag}`, status: over.status },
  });
}

export const PASSWORD = 'contraseña-segura-123';

export async function createUser(
  owner: PrismaClient,
  over: {
    companyId: string | null;
    role?: UserRole;
    status?: 'invited' | 'active' | 'disabled';
    password?: string;
  },
) {
  return owner.user.create({
    data: {
      companyId: over.companyId,
      email: `usuario-${unique()}@example.com`,
      name: 'Usuario Prueba',
      role: over.role ?? 'operator',
      status: over.status ?? 'active',
      passwordHash: await hashPassword(over.password ?? PASSWORD),
    },
  });
}

/** Extrae el valor de la cookie de refresh de una respuesta, o undefined. */
export function refreshCookie(setCookie: string[] | string | undefined): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = list.find((c) => c.startsWith('pv_refresh='));
  const value = raw?.split(';')[0]?.slice('pv_refresh='.length);
  return value ? decodeURIComponent(value) : undefined;
}

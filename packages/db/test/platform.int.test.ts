import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, listActiveCompanies, type PrismaClient } from '../src/index.js';
import { testDatabaseUrl, testServiceDatabaseUrl } from '../testing/index.js';

let owner: PrismaClient;
let service: PrismaClient;

beforeAll(() => {
  owner = createPrismaClient(testDatabaseUrl('db'));
  service = createPrismaClient(testServiceDatabaseUrl('db'));
});
afterAll(() => Promise.all([owner.$disconnect(), service.$disconnect()]));

describe('listActiveCompanies', () => {
  it('excluye las empresas suspendidas (sus jobs se pausan)', async () => {
    const tag = Date.now();
    const active = await owner.company.create({
      data: { name: 'Activa', slug: `activa-${tag}`, timezone: 'America/Mazatlan' },
    });
    const suspended = await owner.company.create({
      data: { name: 'Suspendida', slug: `suspendida-${tag}`, status: 'suspended' },
    });
    const ids = (await listActiveCompanies(service)).map((c) => c.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(suspended.id);
  });
});

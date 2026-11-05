import { COMPANY_INTEGRATIONS, CredentialCipher } from '@pv/adapters';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  TEST_ENV,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Llaves de integraciones de la empresa (GoodWe como "usuario de organización",
// docs/fabricantes/goodwe-openapi.md). La prueba de conexión se sustituye: no se llama a GoodWe.

let ctx: TestContext;
let testResult: 'ok' | 'fail' = 'ok';
const tested: unknown[] = [];
beforeAll(async () => {
  ctx = await createTestContext(
    {},
    {
      companyIntegrations: {
        goodwe: {
          schema: COMPANY_INTEGRATIONS.goodwe.schema,
          test: async (creds) => {
            tested.push(creds);
            if (testResult === 'fail') throw Object.assign(new Error('x'), { code: '10001' });
            return { ok: true };
          },
        },
      },
    },
  );
});
afterAll(() => ctx.close());

const goodwe = { client_id: 'cliente-123', client_secret: 'Secreto-GoodWe-987', region: 'us' };

async function companyWithAdmin() {
  const company = await createCompany(ctx.owner);
  const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
  const operator = await createUser(ctx.owner, { companyId: company.id, role: 'operator' });
  return {
    company,
    auth: `Bearer ${await tokenFor(admin, ctx.clock.current)}`,
    operatorAuth: `Bearer ${await tokenFor(operator, ctx.clock.current)}`,
  };
}
const send = (
  method: 'get' | 'put' | 'post' | 'delete',
  path: string,
  auth: string,
  body?: object,
) => request(ctx.app)[method](`/api${path}`).set('Authorization', auth).send(body);

describe('integraciones de la empresa', () => {
  it('el administrador guarda las llaves de GoodWe cifradas y la API nunca las devuelve', async () => {
    const { company, auth } = await companyWithAdmin();
    const before = await send('get', '/company/integrations', auth);
    const empty = { configured: false, updated_at: null, last_test_at: null, last_test_ok: null };
    expect(before.body.data).toEqual([
      { provider: 'goodwe', ...empty },
      { provider: 'enphase', ...empty },
    ]);

    const put = await send('put', '/company/integrations/goodwe', auth, { credentials: goodwe });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ provider: 'goodwe', configured: true });
    const list = await send('get', '/company/integrations', auth);
    expect(list.body.data[0].configured).toBe(true);
    for (const body of [put.body, list.body]) {
      expect(JSON.stringify(body)).not.toContain('Secreto-GoodWe');
      expect(JSON.stringify(body)).not.toContain('cliente-123');
    }

    const row = await ctx.owner.companyIntegration.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(Buffer.from(row.ciphertext).toString('utf8')).not.toContain('Secreto');
    const cipher = CredentialCipher.fromEnv(TEST_ENV);
    expect(cipher.decrypt(row, { companyId: company.id, integration: 'goodwe' })).toEqual(goodwe);
    const audit = await ctx.owner.auditLog.findFirstOrThrow({
      where: { companyId: company.id, action: 'company.integration_updated' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Secreto');
  });

  it('valida las llaves y el proveedor', async () => {
    const { auth } = await companyWithAdmin();
    const bad = await send('put', '/company/integrations/goodwe', auth, {
      credentials: { ...goodwe, region: 'mx' },
    });
    expect(bad.status).toBe(400);
    const unknown = await send('put', '/company/integrations/huawei', auth, {
      credentials: goodwe,
    });
    expect(unknown.status).toBe(404);
  });

  it('prueba la conexión con las llaves descifradas y guarda el resultado', async () => {
    const { auth } = await companyWithAdmin();
    expect((await send('post', '/company/integrations/goodwe/test', auth)).status).toBe(404);
    await send('put', '/company/integrations/goodwe', auth, { credentials: goodwe });

    testResult = 'ok';
    const ok = await send('post', '/company/integrations/goodwe/test', auth);
    expect(ok.body).toMatchObject({ ok: true, message: 'Conexión exitosa' });
    expect(tested.at(-1)).toEqual(goodwe);

    testResult = 'fail';
    const fail = await send('post', '/company/integrations/goodwe/test', auth);
    expect(fail.body.ok).toBe(false);
    expect(JSON.stringify(fail.body)).not.toContain('10001');
    const list = await send('get', '/company/integrations', auth);
    expect(list.body.data[0].last_test_ok).toBe(false);
    // El aviso en el log no repite las llaves.
    expect(ctx.logLines.join('\n')).not.toContain('Secreto-GoodWe');
  });

  it('el administrador puede borrarlas; el operador no puede ver ni tocar nada', async () => {
    const { auth, operatorAuth } = await companyWithAdmin();
    await send('put', '/company/integrations/goodwe', auth, { credentials: goodwe });
    for (const [method, path] of [
      ['get', '/company/integrations'],
      ['put', '/company/integrations/goodwe'],
      ['post', '/company/integrations/goodwe/test'],
      ['delete', '/company/integrations/goodwe'],
    ] as const) {
      expect((await send(method, path, operatorAuth, { credentials: goodwe })).status, path).toBe(
        403,
      );
    }
    expect((await send('delete', '/company/integrations/goodwe', auth)).status).toBe(204);
    expect((await send('delete', '/company/integrations/goodwe', auth)).status).toBe(404);
  });

  it('las llaves de una empresa no se ven ni se prueban desde otra', async () => {
    const a = await companyWithAdmin();
    const b = await companyWithAdmin();
    await send('put', '/company/integrations/goodwe', a.auth, { credentials: goodwe });
    const listB = await send('get', '/company/integrations', b.auth);
    expect(listB.body.data[0].configured).toBe(false);
    expect((await send('post', '/company/integrations/goodwe/test', b.auth)).status).toBe(404);
    expect((await send('delete', '/company/integrations/goodwe', b.auth)).status).toBe(404);
    expect(await ctx.owner.companyIntegration.count({ where: { companyId: a.company.id } })).toBe(
      1,
    );
  });
});

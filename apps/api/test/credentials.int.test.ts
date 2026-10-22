import { randomBytes } from 'node:crypto';
import { adapterRegistry, CredentialCipher, type InverterAdapter } from '@pv/adapters';
import type { UserRole } from '@pv/db';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TEST_ENV, tokenFor, type TestContext } from './helpers.js';

// CA de F2-T3: ninguna respuesta de la API ni ningún log contiene las credenciales.

const SECRET_USER = `usuario-${randomBytes(6).toString('hex')}`;
const SECRET_PASS = `Clave-${randomBytes(9).toString('hex')}-Zz9`;
const SECRET_TOKEN = `tok_${randomBytes(12).toString('hex')}`;
const SECRETS = [SECRET_USER, SECRET_PASS, SECRET_TOKEN];

const received: unknown[] = [];

/** GoodWe de prueba: acepta solo la contraseña correcta. */
const okAdapter: InverterAdapter = {
  provider: 'goodwe',
  testConnection: async (creds) => {
    received.push(creds);
    return { ok: (creds as { password?: string }).password === SECRET_PASS };
  },
  fetchReadings: async () => [],
};
/** Huawei de prueba: falla repitiendo la contraseña en el mensaje, como haría un SDK descuidado. */
const leakyAdapter: InverterAdapter = {
  provider: 'huawei',
  testConnection: async (creds) => {
    throw new Error(`login rechazado para ${(creds as { password: string }).password}`);
  },
  fetchReadings: async () => [],
};

let ctx: TestContext;
const responses: Response[] = [];

beforeAll(async () => {
  ctx = await createTestContext(
    {},
    { inverterAdapters: { ...adapterRegistry, goodwe: okAdapter, huawei: leakyAdapter } },
  );
});
afterAll(() => ctx.close());

/** Guarda cada respuesta para revisarlas todas al final. */
async function track(req: request.Test): Promise<Response> {
  const res = await req;
  responses.push(res);
  return res;
}

async function session(role: UserRole = 'operator') {
  const company = await ctx.owner.company.create({
    data: { name: 'Empresa', slug: `cred-${Date.now()}-${Math.random()}` },
  });
  const user = await createUser(ctx.owner, { companyId: company.id, role });
  const client = await ctx.owner.client.create({
    data: {
      companyId: company.id,
      name: 'Cliente',
      address: 'Calle 1',
      colonia: 'Centro',
      postalCode: '80000',
      lat: 24.8,
      lon: -107.39,
    },
  });
  return { company, user, client, auth: `Bearer ${await tokenFor(user, ctx.clock.current)}` };
}

async function plant(s: Awaited<ReturnType<typeof session>>, brand = 'goodwe') {
  const res = await track(
    request(ctx.app)
      .post('/api/plants')
      .set('Authorization', s.auth)
      .send({
        client_id: s.client.id,
        name: `Planta ${brand}`,
        capacity_kwp: 5,
        inverter_brand: brand,
      }),
  );
  return res.body.id as string;
}

const creds = { username: SECRET_USER, password: SECRET_PASS, api_token: SECRET_TOKEN };
const put = (auth: string, id: string, body: object = { credentials: creds }) =>
  track(
    request(ctx.app).put(`/api/plants/${id}/credentials`).set('Authorization', auth).send(body),
  );
const test = (auth: string, id: string) =>
  track(request(ctx.app).post(`/api/plants/${id}/credentials/test`).set('Authorization', auth));
const getPlant = (auth: string, id: string) =>
  track(request(ctx.app).get(`/api/plants/${id}`).set('Authorization', auth));

describe('PUT /api/plants/:id/credentials', () => {
  it('cifra y guarda; responde solo el estado', async () => {
    const s = await session();
    const id = await plant(s);
    const res = await put(s.auth, id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      has_credentials: true,
      provider: 'goodwe',
      updated_at: expect.any(String),
      last_test_at: null,
      last_test_ok: null,
    });

    const row = await ctx.owner.inverterCredential.findUniqueOrThrow({ where: { plantId: id } });
    expect(row).toMatchObject({ companyId: s.company.id, provider: 'goodwe', keyVersion: 1 });
    expect(row.iv).toHaveLength(12);
    expect(row.authTag).toHaveLength(16);
    const stored = Buffer.concat([row.ciphertext, row.iv, row.authTag]).toString('latin1');
    for (const secret of SECRETS) expect(stored).not.toContain(secret);

    // Se puede descifrar con la llave de la empresa, ligada a esta planta.
    const cipher = CredentialCipher.fromEnv(TEST_ENV);
    expect(cipher.decrypt(row, { companyId: s.company.id, plantId: id })).toEqual(creds);

    const got = await getPlant(s.auth, id);
    expect(got.body.credentials).toMatchObject({ has_credentials: true, provider: 'goodwe' });
  });

  it('una planta sin credenciales lo indica', async () => {
    const s = await session();
    const id = await plant(s);
    expect((await getPlant(s.auth, id)).body.credentials).toEqual({
      has_credentials: false,
      provider: null,
      updated_at: null,
      last_test_at: null,
      last_test_ok: null,
    });
  });

  it('reemplazar reinicia la prueba y se audita sin el contenido', async () => {
    const s = await session();
    const id = await plant(s);
    await put(s.auth, id);
    await test(s.auth, id);
    const replaced = await put(s.auth, id, {
      credentials: { ...creds, password: `${SECRET_PASS}2` },
    });
    expect(replaced.body).toMatchObject({ last_test_at: null, last_test_ok: null });

    const audits = await ctx.owner.auditLog.findMany({
      where: { entityId: id, action: 'plant.credentials_updated' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      { provider: 'goodwe', replaced: false },
      { provider: 'goodwe', replaced: true },
    ]);
    expect(audits[0]).toMatchObject({ userId: s.user.id, companyId: s.company.id });
  });

  it('valida el cuerpo sin repetir los valores en el error', async () => {
    const s = await session();
    const id = await plant(s);
    for (const body of [
      {},
      { credentials: {} },
      { credentials: { password: SECRET_PASS, nested: { token: SECRET_TOKEN } } },
      {
        credentials: Object.fromEntries(
          Array.from({ length: 21 }, (_, i) => [`k${i}`, SECRET_PASS]),
        ),
      },
    ]) {
      const res = await put(s.auth, id, body);
      expect(res.status, JSON.stringify(Object.keys(body))).toBe(400);
    }
  });

  it('cambiar la marca de la planta borra sus credenciales', async () => {
    const s = await session();
    const id = await plant(s);
    await put(s.auth, id);
    await track(
      request(ctx.app)
        .patch(`/api/plants/${id}`)
        .set('Authorization', s.auth)
        .send({ inverter_brand: 'fronius' }),
    );
    expect(await ctx.owner.inverterCredential.count({ where: { plantId: id } })).toBe(0);
    expect((await getPlant(s.auth, id)).body.credentials.has_credentials).toBe(false);
  });
});

describe('POST /api/plants/:id/credentials/test', () => {
  it('pasa las credenciales descifradas al adaptador y responde éxito', async () => {
    const s = await session();
    const id = await plant(s);
    await put(s.auth, id);
    const res = await test(s.auth, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, message: 'Conexión exitosa' });
    expect(received.at(-1)).toEqual(creds);
    expect((await getPlant(s.auth, id)).body.credentials).toMatchObject({ last_test_ok: true });
  });

  it('ante cualquier fallo responde un error genérico, sin el mensaje del proveedor', async () => {
    const s = await session();
    const leaky = await plant(s, 'huawei');
    await put(s.auth, leaky);
    const res = await test(s.auth, leaky);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      message:
        'No se pudo conectar con el proveedor. Revisa las credenciales e inténtalo de nuevo.',
    });
    expect((await getPlant(s.auth, leaky)).body.credentials.last_test_ok).toBe(false);

    // Un adaptador real sin implementar (sin documentación oficial) también responde genérico.
    const fronius = await plant(s, 'fronius');
    await put(s.auth, fronius);
    expect((await test(s.auth, fronius)).body.ok).toBe(false);
  });

  it('sin credenciales responde 409, salvo el simulador que no las necesita', async () => {
    const s = await session();
    const noCreds = await test(s.auth, await plant(s));
    expect(noCreds.status).toBe(409);
    expect(noCreds.body.error.code).toBe('NO_CREDENTIALS');
    const sim = await test(s.auth, await plant(s, 'simulator'));
    expect(sim.body).toMatchObject({ ok: true });
  });

  it('limita a 5 pruebas por minuto por planta', async () => {
    const s = await session();
    const id = await plant(s, 'simulator');
    for (let i = 0; i < 5; i++) expect((await test(s.auth, id)).status).toBe(200);
    expect((await test(s.auth, id)).status).toBe(429);
  });
});

describe('permisos y aislamiento', () => {
  it('el técnico no puede capturar ni probar credenciales', async () => {
    const owner = await session();
    const id = await plant(owner);
    const tech = await createUser(ctx.owner, { companyId: owner.company.id, role: 'technician' });
    const auth = `Bearer ${await tokenFor(tech, ctx.clock.current)}`;
    expect((await put(auth, id)).status).toBe(403);
    expect((await test(auth, id)).status).toBe(403);
  });

  it('una planta de otra empresa responde 404 y no se guarda nada', async () => {
    const a = await session();
    const b = await session();
    const ofB = await plant(b);
    expect((await put(a.auth, ofB)).status).toBe(404);
    expect((await test(a.auth, ofB)).status).toBe(404);
    expect(await ctx.owner.inverterCredential.count({ where: { plantId: ofB } })).toBe(0);
  });
});

describe('CA F2-T3: los secretos no aparecen en ninguna respuesta ni log', () => {
  it('revisa todas las respuestas, los logs y la auditoría de esta suite', async () => {
    // Recorre también la lista de plantas de una empresa con credenciales.
    const s = await session();
    const id = await plant(s);
    await put(s.auth, id);
    await track(request(ctx.app).get('/api/plants?page_size=100').set('Authorization', s.auth));

    expect(responses.length).toBeGreaterThan(30);
    const everything = [
      ...responses.map((r) => `${JSON.stringify(r.headers)}\n${r.text}`),
      ...ctx.logLines,
      JSON.stringify(await ctx.owner.auditLog.findMany()),
    ].join('\n');
    expect(ctx.logLines.join('\n')).toContain('falló la prueba de conexión');
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });
});

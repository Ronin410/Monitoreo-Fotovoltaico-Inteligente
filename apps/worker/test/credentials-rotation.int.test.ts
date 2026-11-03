import { randomBytes } from 'node:crypto';
import { CredentialCipher } from '@pv/adapters';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCredentials } from '../src/credentials-rotation.js';
import {
  createCompanyWithClient,
  createPlant,
  createWorkerTestContext,
  type WorkerTestContext,
} from './helpers.js';

// Rotación de la llave de credenciales (docs/respuesta-incidentes.md).

let ctx: WorkerTestContext;
beforeAll(async () => {
  ctx = await createWorkerTestContext();
});
afterAll(() => ctx.close());

describe('rotación de la llave de credenciales', () => {
  it('vuelve a cifrar con la llave nueva y luego la anterior ya no hace falta', async () => {
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    const v1 = new CredentialCipher(1, { 1: k1 });
    const { company, client } = await createCompanyWithClient(ctx.owner);
    const suspended = await createCompanyWithClient(ctx.owner, { status: 'suspended' });
    const secret = { username: 'u', password: 'S3creto-rotacion' };
    for (const c of [{ company, client }, suspended]) {
      const plant = await createPlant(ctx.owner, c.company.id, c.client.id);
      const enc = v1.encrypt(secret, { companyId: c.company.id, plantId: plant.id });
      await ctx.owner.inverterCredential.create({
        data: { companyId: c.company.id, plantId: plant.id, provider: 'goodwe', ...enc },
      });
    }

    // Sin la llave anterior cargada: no puede rotar y lo reporta.
    const v2only = new CredentialCipher(2, { 2: k2 });
    const blocked = await rotateCredentials(ctx.db, ctx.serviceDb, v2only);
    expect(blocked.missingKey).toBeGreaterThanOrEqual(2);
    expect(blocked.rotated).toBe(0);

    // Con la anterior: rota todas, también las de la empresa suspendida.
    const rotating = CredentialCipher.fromEnv({
      CREDENTIALS_ENC_KEY: k2.toString('base64'),
      CREDENTIALS_KEY_VERSION: 2,
      CREDENTIALS_PREVIOUS_KEYS: { 1: k1.toString('base64') },
    });
    const done = await rotateCredentials(ctx.db, ctx.serviceDb, rotating);
    expect(done.rotated).toBeGreaterThanOrEqual(2);
    const rows = await ctx.owner.inverterCredential.findMany({
      where: { companyId: { in: [company.id, suspended.company.id] } },
    });
    expect(rows.map((r) => r.keyVersion)).toEqual([2, 2]);
    // Ya solo hace falta la llave nueva.
    for (const r of rows) {
      expect(v2only.decrypt(r, { companyId: r.companyId, plantId: r.plantId })).toEqual(secret);
    }
    expect((await rotateCredentials(ctx.db, ctx.serviceDb, rotating)).rotated).toBe(0);
  });
});

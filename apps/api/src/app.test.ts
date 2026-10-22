import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test/helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('app', () => {
  it('GET /health responde ok sin autenticación', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('responde 404 con el formato de error de la API', async () => {
    const res = await request(ctx.app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
  });

  it('rechaza JSON inválido y cuerpos demasiado grandes', async () => {
    const bad = await request(ctx.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const big = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it('envía encabezados de seguridad y CORS restringido a APP_URL', async () => {
    const res = await request(ctx.app).get('/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');

    const other = await request(ctx.app).get('/health').set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });
});

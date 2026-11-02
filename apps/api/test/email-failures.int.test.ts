import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createTestContext,
  createUser,
  freshIp,
  tokenFor,
  type TestContext,
} from './helpers.js';

// Si el proveedor de correo rechaza el envío (por ejemplo, Resend 403 con un dominio sin
// verificar), la recuperación de contraseña responde igual que siempre y lo ya guardado
// (empresa, invitación) responde con éxito y email_sent: false, en lugar de un error 500.

let ctx: TestContext;
let realSend: TestContext['email']['send'];
beforeAll(async () => {
  ctx = await createTestContext();
  realSend = ctx.email.send.bind(ctx.email);
});
afterEach(() => {
  ctx.email.send = realSend;
});
afterAll(() => ctx.close());

/** Simula el rechazo del proveedor (mismo mensaje que el adaptador de Resend). */
function failEmails() {
  ctx.email.send = async () => {
    throw new Error('Resend respondió 403');
  };
}
const logs = () => ctx.logLines.join('\n');

describe('falla del proveedor de correo', () => {
  it('recuperar contraseña responde 200 y solo deja la falla en el log, sin el enlace', async () => {
    const company = await createCompany(ctx.owner);
    const user = await createUser(ctx.owner, { companyId: company.id });
    failEmails();
    const res = await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', freshIp())
      .send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Igual que con un correo inexistente: no revela que la cuenta existe.
    const unknown = await request(ctx.app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'nadie@example.com' });
    expect(unknown.body).toEqual(res.body);
    expect(logs()).toContain('no se pudo enviar el correo de recuperación');
    expect(logs()).toContain('Resend respondió 403');
    expect(logs()).not.toContain('restablecer-contrasena/');
  });

  it('invitar a un usuario guarda la invitación y responde email_sent: false', async () => {
    const company = await createCompany(ctx.owner);
    const admin = await createUser(ctx.owner, { companyId: company.id, role: 'company_admin' });
    failEmails();
    const res = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', `Bearer ${await tokenFor(admin, ctx.clock.current)}`)
      .send({ email: 'tecnico-sin-correo@example.com', role: 'technician' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'tecnico-sin-correo@example.com', email_sent: false });
    expect(await ctx.owner.invitation.count({ where: { id: res.body.id } })).toBe(1);
    expect(logs()).not.toContain('/invitacion/');

    // Con el correo funcionando se puede volver a invitar.
    ctx.email.send = realSend;
    const again = await request(ctx.app)
      .post('/api/company/invitations')
      .set('Authorization', `Bearer ${await tokenFor(admin, ctx.clock.current)}`)
      .send({ email: 'tecnico-sin-correo@example.com', role: 'technician' });
    expect(again.body).toMatchObject({ email_sent: true });
  });

  it('crear una empresa la guarda y responde email_sent: false', async () => {
    const superadmin = await createUser(ctx.owner, { companyId: null, role: 'superadmin' });
    failEmails();
    const res = await request(ctx.app)
      .post('/api/admin/companies')
      .set('Authorization', `Bearer ${await tokenFor(superadmin, ctx.clock.current)}`)
      .send({
        name: `Empresa sin correo ${Date.now()}`,
        admin_email: 'admin-sin-correo@example.com',
      });
    expect(res.status).toBe(201);
    expect(res.body.email_sent).toBe(false);
    expect(await ctx.owner.company.count({ where: { id: res.body.company.id } })).toBe(1);
  });
});

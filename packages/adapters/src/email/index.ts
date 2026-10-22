import type { Env } from '@pv/config';
import { ResendEmailProvider } from './resend.js';
import { SmtpEmailProvider } from './smtp.js';
import type { EmailProvider } from './types.js';

export { MemoryEmailProvider } from './memory.js';
export { ResendEmailProvider } from './resend.js';
export { SmtpEmailProvider } from './smtp.js';
export type { EmailMessage, EmailProvider } from './types.js';

/** Crea el proveedor de correo según EMAIL_PROVIDER (la configuración ya viene validada). */
export function createEmailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend') {
    return new ResendEmailProvider({ from: env.EMAIL_FROM, apiKey: env.RESEND_API_KEY ?? '' });
  }
  return new SmtpEmailProvider({
    from: env.EMAIL_FROM,
    host: env.SMTP_HOST ?? '',
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
  });
}

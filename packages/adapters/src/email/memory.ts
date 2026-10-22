import type { EmailMessage, EmailProvider } from './types.js';

/** Guarda los correos en memoria. Solo para pruebas. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Último correo enviado a `to`, o undefined. */
  lastTo(to: string): EmailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}

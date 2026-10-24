import type { EmailMessage, EmailProvider } from './types.js';

const RESEND_URL = 'https://api.resend.com/emails';

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly config: { from: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.attachments?.length && {
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
            content_type: a.contentType,
          })),
        }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // No se incluye el cuerpo de la respuesta: puede repetir datos del destinatario.
      throw new Error(`Resend respondió ${res.status}`);
    }
  }
}

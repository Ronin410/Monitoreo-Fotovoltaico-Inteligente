import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider } from './types.js';

export type SmtpConfig = {
  from: string;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
};

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }
}

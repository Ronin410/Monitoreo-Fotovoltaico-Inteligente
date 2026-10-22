export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** Envío de correo intercambiable (specs/01: Resend o SMTP). */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

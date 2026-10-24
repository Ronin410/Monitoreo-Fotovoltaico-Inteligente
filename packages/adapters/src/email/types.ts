export type EmailAttachment = { filename: string; content: Buffer; contentType: string };

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Archivos adjuntos (el PDF del reporte mensual). */
  attachments?: EmailAttachment[];
};

/** Envío de correo intercambiable (specs/01: Resend o SMTP). */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

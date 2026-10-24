import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend.js';

describe('ResendEmailProvider', () => {
  it('envía el correo con la llave en el encabezado', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const provider = new ResendEmailProvider(
      { from: 'PV <no-reply@example.com>', apiKey: 're_test' },
      fetchMock as unknown as typeof fetch,
    );
    await provider.send({ to: 'ana@example.com', subject: 'Hola', text: 'Texto' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'PV <no-reply@example.com>',
      to: ['ana@example.com'],
      subject: 'Hola',
      text: 'Texto',
    });
  });

  it('manda los adjuntos en base64', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const provider = new ResendEmailProvider(
      { from: 'x@example.com', apiKey: 'k' },
      fetchMock as unknown as typeof fetch,
    );
    await provider.send({
      to: 'ana@example.com',
      subject: 's',
      text: 't',
      attachments: [
        { filename: 'reporte.pdf', content: Buffer.from('%PDF-'), contentType: 'application/pdf' },
      ],
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).attachments).toEqual([
      { filename: 'reporte.pdf', content: 'JVBERi0=', content_type: 'application/pdf' },
    ]);
  });

  it('falla sin exponer la respuesta del proveedor', async () => {
    const fetchMock = vi.fn(async () => new Response('ana@example.com inválido', { status: 422 }));
    const provider = new ResendEmailProvider(
      { from: 'x@example.com', apiKey: 'k' },
      fetchMock as unknown as typeof fetch,
    );
    await expect(provider.send({ to: 'ana@example.com', subject: 's', text: 't' })).rejects.toThrow(
      /^Resend respondió 422$/,
    );
  });
});

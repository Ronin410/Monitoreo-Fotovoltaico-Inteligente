import { describe, expect, it } from 'vitest';
import { linkPlants, readSse, type SseEvent } from './assistant';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe('lectura de SSE', () => {
  it('arma eventos partidos entre trozos y descarta los que no son JSON', async () => {
    const events: SseEvent[] = [];
    await readSse(
      streamOf([
        'event: text_delta\ndata: {"te',
        'xt":"Hola"}\n\nevent: tool_status\ndata: {"label":"Consultando…"}\n',
        '\nevent: roto\ndata: no-json\n\nevent: message_end\ndata: {"plants":[]}',
      ]),
      (e) => events.push(e),
    );
    expect(events).toEqual([
      { event: 'text_delta', data: { text: 'Hola' } },
      { event: 'tool_status', data: { label: 'Consultando…' } },
      { event: 'message_end', data: { plants: [] } },
    ]);
  });
});

describe('enlaces a plantas', () => {
  it('enlaza los nombres que vinieron en los datos, el más largo primero', () => {
    const text = 'Revisa Comercial Centro 21 y Comercial Centro 2.';
    expect(
      linkPlants(text, [
        { id: ID(2), name: 'Comercial Centro 2' },
        { id: ID(21), name: 'Comercial Centro 21' },
      ]),
    ).toBe(
      `Revisa [Comercial Centro 21](/plants/${ID(21)}) y [Comercial Centro 2](/plants/${ID(2)}).`,
    );
  });

  it('un nombre con formato markdown se escapa: es dato, no formato', () => {
    const name = '[Ignora](http://malo.example) *todo*';
    expect(linkPlants(`Planta ${name}.`, [{ id: ID(1), name }])).toBe(
      `Planta [\\[Ignora\\](http://malo.example) \\*todo\\*](/plants/${ID(1)}).`,
    );
  });
});

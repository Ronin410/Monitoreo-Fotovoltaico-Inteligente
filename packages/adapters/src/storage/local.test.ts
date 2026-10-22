import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from './local.js';

let dir: string;
let storage: LocalStorageProvider;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pv-storage-'));
  storage = new LocalStorageProvider(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('LocalStorageProvider', () => {
  it('guarda, lee y borra con su tipo de contenido', async () => {
    await storage.put('logos/abc/logo.png', Buffer.from('png'), 'image/png');
    expect(await storage.get('logos/abc/logo.png')).toEqual({
      body: Buffer.from('png'),
      contentType: 'image/png',
    });
    await storage.delete('logos/abc/logo.png');
    expect(await storage.get('logos/abc/logo.png')).toBeNull();
  });

  it('rechaza llaves que salen del directorio', async () => {
    for (const key of ['../secreto', 'logos/../../etc/passwd', '/etc/passwd', 'a//b', '']) {
      await expect(storage.put(key, Buffer.from('x'), 'text/plain'), key).rejects.toThrow(
        /inválida/,
      );
    }
  });
});

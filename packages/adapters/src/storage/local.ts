import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertSafeKey, type StorageProvider, type StoredObject } from './types.js';

/** Disco local (desarrollo). El tipo de contenido se guarda junto al archivo. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.path(key);
    try {
      const [body, meta] = await Promise.all([
        readFile(file),
        readFile(`${file}.meta.json`, 'utf8'),
      ]);
      return { body, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.path(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }
}

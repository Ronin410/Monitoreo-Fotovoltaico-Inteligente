import { assertSafeKey, type StorageProvider, type StoredObject } from './types.js';

/** En memoria. Solo para pruebas. */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = 'memory';
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

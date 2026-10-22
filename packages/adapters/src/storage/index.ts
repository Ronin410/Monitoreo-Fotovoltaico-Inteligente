import type { Env } from '@pv/config';
import { LocalStorageProvider } from './local.js';
import { S3StorageProvider } from './s3.js';
import type { StorageProvider } from './types.js';

export { LocalStorageProvider } from './local.js';
export { MemoryStorageProvider } from './memory.js';
export { S3StorageProvider } from './s3.js';
export { assertSafeKey, type StorageProvider, type StoredObject } from './types.js';

/** Según STORAGE_PROVIDER (la configuración ya viene validada). */
export function createStorageProvider(env: Env): StorageProvider {
  if (env.STORAGE_PROVIDER === 's3') {
    return new S3StorageProvider({
      endpoint: env.S3_ENDPOINT ?? '',
      bucket: env.S3_BUCKET ?? '',
      accessKey: env.S3_ACCESS_KEY ?? '',
      secretKey: env.S3_SECRET_KEY ?? '',
    });
  }
  return new LocalStorageProvider(env.LOCAL_STORAGE_DIR);
}

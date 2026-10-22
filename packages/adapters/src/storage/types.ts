export type StoredObject = { body: Buffer; contentType: string };

/** Archivos (logos y PDFs) intercambiables: disco local en desarrollo, S3 en producción (specs/01). */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null si no existe. */
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** Llaves seguras: segmentos alfanuméricos separados por "/" (sin "..", sin rutas absolutas). */
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/.test(key) || key.includes('..')) {
    throw new Error('Llave de almacenamiento inválida');
  }
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifrado de credenciales de inversor con AES-256-GCM (specs/02 §Credenciales de inversores):
// IV aleatorio por registro, etiqueta de autenticación y key_version para rotación.
// El texto cifrado queda ligado a su empresa y planta (AAD): copiarlo a otra fila no descifra.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Mismos tipos que las columnas bytea de Prisma (Uint8Array). */
export type EncryptedCredentials = {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  keyVersion: number;
};

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => Uint8Array.from(b);

export type CredentialOwner = { companyId: string; plantId: string };

export class CredentialDecryptError extends Error {
  constructor() {
    // Sin detalles: nunca se expone nada del contenido.
    super('No se pudieron descifrar las credenciales');
    this.name = 'CredentialDecryptError';
  }
}

export class CredentialCipher {
  private readonly keys: Map<number, Buffer>;

  /**
   * @param currentVersion versión con la que se cifra (CREDENTIALS_KEY_VERSION)
   * @param keys llaves de 32 bytes por versión; la actual y, durante una rotación, las anteriores
   */
  constructor(
    private readonly currentVersion: number,
    keys: Record<number, Buffer>,
  ) {
    this.keys = new Map(Object.entries(keys).map(([v, k]) => [Number(v), k]));
    for (const [version, key] of this.keys) {
      if (key.length !== 32)
        throw new Error(`La llave de credenciales v${version} no mide 32 bytes`);
    }
    if (!this.keys.has(currentVersion)) {
      throw new Error(`Falta la llave de credenciales v${currentVersion}`);
    }
  }

  /** A partir de CREDENTIALS_ENC_KEY (base64) y CREDENTIALS_KEY_VERSION. */
  static fromEnv(env: { CREDENTIALS_ENC_KEY: string; CREDENTIALS_KEY_VERSION: number }) {
    return new CredentialCipher(env.CREDENTIALS_KEY_VERSION, {
      [env.CREDENTIALS_KEY_VERSION]: Buffer.from(env.CREDENTIALS_ENC_KEY, 'base64'),
    });
  }

  private static aad(owner: CredentialOwner, keyVersion: number): Buffer {
    return Buffer.from(`pv-iot:credentials:${owner.companyId}:${owner.plantId}:v${keyVersion}`);
  }

  encrypt(credentials: unknown, owner: CredentialOwner): EncryptedCredentials {
    const key = this.keys.get(this.currentVersion);
    if (!key) throw new Error(`Falta la llave de credenciales v${this.currentVersion}`);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(CredentialCipher.aad(owner, this.currentVersion));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: bytes(ciphertext),
      iv: bytes(iv),
      authTag: bytes(cipher.getAuthTag()),
      keyVersion: this.currentVersion,
    };
  }

  /** Descifra en memoria. Solo para llamar al proveedor; el resultado nunca se registra. */
  decrypt(
    encrypted: Pick<EncryptedCredentials, 'keyVersion'> & {
      ciphertext: Uint8Array;
      iv: Uint8Array;
      authTag: Uint8Array;
    },
    owner: CredentialOwner,
  ): unknown {
    const key = this.keys.get(encrypted.keyVersion);
    if (!key) throw new CredentialDecryptError();
    try {
      const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
      decipher.setAAD(CredentialCipher.aad(owner, encrypted.keyVersion));
      decipher.setAuthTag(encrypted.authTag);
      const plain = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as unknown;
    } catch {
      throw new CredentialDecryptError();
    }
  }
}

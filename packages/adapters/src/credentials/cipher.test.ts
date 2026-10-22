import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialCipher, CredentialDecryptError } from './cipher.js';

const owner = { companyId: '11111111-1111-4111-8111-111111111111', plantId: 'plant-a' };
const secret = { username: 'instaladora', password: 'S3creto-Ultra-9921' };

describe('CredentialCipher (AES-256-GCM)', () => {
  const cipher = new CredentialCipher(1, { 1: randomBytes(32) });

  it('cifra y descifra; el texto cifrado no contiene el valor en claro', () => {
    const enc = cipher.encrypt(secret, owner);
    expect(enc.keyVersion).toBe(1);
    expect(enc.iv).toHaveLength(12);
    expect(enc.authTag).toHaveLength(16);
    expect(Buffer.from(enc.ciphertext).toString('utf8')).not.toContain('S3creto');
    expect(cipher.decrypt(enc, owner)).toEqual(secret);
  });

  it('usa un IV distinto en cada cifrado', () => {
    const a = cipher.encrypt(secret, owner);
    const b = cipher.encrypt(secret, owner);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it('no descifra si se altera el contenido, la etiqueta o el IV', () => {
    const enc = cipher.encrypt(secret, owner);
    const flip = (b: Uint8Array) => {
      const c = Uint8Array.from(b);
      c[0] = (c[0] ?? 0) ^ 1;
      return c;
    };
    for (const bad of [
      { ...enc, ciphertext: flip(enc.ciphertext) },
      { ...enc, authTag: flip(enc.authTag) },
      { ...enc, iv: flip(enc.iv) },
    ]) {
      expect(() => cipher.decrypt(bad, owner)).toThrow(CredentialDecryptError);
    }
  });

  it('no descifra si se copia a otra planta o empresa (AAD)', () => {
    const enc = cipher.encrypt(secret, owner);
    expect(() => cipher.decrypt(enc, { ...owner, plantId: 'plant-b' })).toThrow(
      CredentialDecryptError,
    );
    expect(() =>
      cipher.decrypt(enc, { ...owner, companyId: '22222222-2222-4222-8222-222222222222' }),
    ).toThrow(CredentialDecryptError);
  });

  it('con otra llave no descifra, y el error no revela nada', () => {
    const enc = cipher.encrypt(secret, owner);
    const other = new CredentialCipher(1, { 1: randomBytes(32) });
    try {
      other.decrypt(enc, owner);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialDecryptError);
      expect(String(err)).not.toContain('S3creto');
    }
  });

  it('descifra con una versión anterior durante la rotación', () => {
    const v1 = randomBytes(32);
    const old = new CredentialCipher(1, { 1: v1 });
    const enc = old.encrypt(secret, owner);
    const rotated = new CredentialCipher(2, { 1: v1, 2: randomBytes(32) });
    expect(rotated.decrypt(enc, owner)).toEqual(secret);
    expect(rotated.encrypt(secret, owner).keyVersion).toBe(2);
  });

  it('rechaza llaves de tamaño incorrecto', () => {
    expect(() => new CredentialCipher(1, { 1: randomBytes(16) })).toThrow();
  });
});

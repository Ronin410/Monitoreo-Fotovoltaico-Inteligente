import { CredentialDecryptError, type CredentialCipher } from '@pv/adapters';
import { withTenant, type PrismaClient } from '@pv/db';

// Rotación de la llave de credenciales de inversores (docs/respuesta-incidentes.md): vuelve a
// cifrar con la llave actual todo lo cifrado con una anterior. Las credenciales descifradas solo
// viven en memoria durante el cambio y nunca se registran.

export type RotationResult = {
  companies: number;
  rotated: number;
  /** Cifradas con una versión cuya llave no se cargó en CREDENTIALS_PREVIOUS_KEYS. */
  missingKey: number;
};

export async function rotateCredentials(
  db: PrismaClient,
  serviceDb: PrismaClient,
  cipher: CredentialCipher,
): Promise<RotationResult> {
  // Todas las empresas, también las suspendidas: sus credenciales también se protegen.
  const companies = await serviceDb.company.findMany({ select: { id: true } });
  const result: RotationResult = { companies: companies.length, rotated: 0, missingKey: 0 };
  for (const { id: companyId } of companies) {
    await withTenant(db, companyId, async (tx) => {
      const old = await tx.inverterCredential.findMany({
        where: { keyVersion: { not: cipher.version } },
      });
      for (const row of old) {
        const owner = { companyId, plantId: row.plantId };
        let plain: unknown;
        try {
          plain = cipher.decrypt(row, owner);
        } catch (err) {
          if (err instanceof CredentialDecryptError) {
            result.missingKey++;
            continue;
          }
          throw err;
        }
        const enc = cipher.encrypt(plain, owner);
        await tx.inverterCredential.update({
          where: { id: row.id },
          data: {
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            authTag: enc.authTag,
            keyVersion: enc.keyVersion,
          },
        });
        result.rotated++;
      }
    });
  }
  return result;
}

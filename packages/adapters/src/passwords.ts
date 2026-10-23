import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { z } from 'zod';

// argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 iteraciones).
// Algorithm es un const enum ambiental; 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** Política de contraseña: 10 a 128 caracteres (el máximo evita abusar del hash). */
export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña debe tener como máximo 128 caracteres');

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifica la contraseña. Si no hay hash (usuario inexistente o sin contraseña) se verifica
 * contra un hash ficticio para que el tiempo de respuesta no revele si el correo existe.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash) return verify(storedHash, password);
  dummyHash ??= hashPassword('contraseña-ficticia-para-igualar-tiempos');
  await verify(await dummyHash, password);
  return false;
}

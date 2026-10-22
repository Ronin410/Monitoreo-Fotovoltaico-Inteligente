import { createInterface } from 'node:readline/promises';
import { loadEnvOrExit } from '@pv/config';
import { createPrismaClient } from '@pv/db';
import { z } from 'zod';
import { hashPassword, passwordSchema } from '../auth/passwords.js';
import { normalizeEmail } from '../auth/service.js';

// Crea el usuario superadmin (no pertenece a ninguna empresa). Uso:
//   pnpm admin:create-superadmin <correo> "<nombre>"
// La contraseña se lee de la entrada estándar para que no quede en el historial del shell.

const args = z
  .tuple([z.email({ error: 'Correo inválido' }), z.string().trim().min(1, 'Falta el nombre')])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Uso: pnpm admin:create-superadmin <correo> "<nombre>"');
  process.exit(1);
}
const [rawEmail, name] = args.data;

const env = loadEnvOrExit();
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = passwordSchema.safeParse(await rl.question('Contraseña (mínimo 10 caracteres): '));
rl.close();
if (!password.success) {
  console.error(password.error.issues[0]?.message ?? 'Contraseña inválida');
  process.exit(1);
}

const db = createPrismaClient(env.SERVICE_DATABASE_URL);
const email = normalizeEmail(rawEmail);
try {
  if (await db.user.findUnique({ where: { email } })) {
    console.error('Ya existe un usuario con ese correo.');
    process.exit(1);
  }
  const user = await db.user.create({
    data: {
      email,
      name,
      role: 'superadmin',
      status: 'active',
      companyId: null,
      passwordHash: await hashPassword(password.data),
    },
  });
  console.log(`Superadmin creado: ${user.email} (${user.id})`);
} finally {
  await db.$disconnect();
}

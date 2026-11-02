import { randomUUID } from 'node:crypto';
import { createStorageProvider } from '@pv/adapters';
import { loadEnvOrExit } from '@pv/config';

// Comprueba el almacenamiento configurado (STORAGE_PROVIDER): sube un archivo de prueba, lo lee,
// lo compara y lo borra. Uso: pnpm storage:check (con las variables del ambiente cargadas).
// Los errores muestran solo su tipo y mensaje, nunca las llaves.

const env = loadEnvOrExit();
const storage = createStorageProvider(env);
const key = `healthcheck/${randomUUID()}.txt`;
const body = Buffer.from(`PV-IoT ${new Date().toISOString()}`);

const step = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    console.log(`OK    ${name}`);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(`FALLA ${name}: ${e.name}: ${e.message}`);
    process.exit(1);
  }
};

console.log(
  `Almacenamiento: ${storage.name}${env.STORAGE_PROVIDER === 's3' ? ` (bucket ${env.S3_BUCKET})` : ''}`,
);
await step('subir un archivo', () => storage.put(key, body, 'text/plain'));
await step('leerlo y comparar', async () => {
  const got = await storage.get(key);
  if (!got || !got.body.equals(body)) throw new Error('el contenido leído no coincide');
});
await step('borrarlo', () => storage.delete(key));
await step('ya no existe', async () => {
  if (await storage.get(key)) throw new Error('el archivo sigue existiendo');
});
console.log('El almacenamiento funciona.');

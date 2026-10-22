import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Las pruebas de integración comparten una sola base de datos.
    fileParallelism: false,
  },
});

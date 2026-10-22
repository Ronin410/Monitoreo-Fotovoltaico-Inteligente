import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Los paquetes internos (@pv/*) se publican como código fuente TS y se empaquetan aquí.
  noExternal: [/^@pv\//],
});

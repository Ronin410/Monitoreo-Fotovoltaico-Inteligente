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
  // Las dependencias CommonJS empaquetadas (por ejemplo pg) usan require(); en ESM hay que
  // proveerlo.
  banner: {
    js: "import { createRequire as __pvCreateRequire } from 'node:module'; const require = __pvCreateRequire(import.meta.url);",
  },
});

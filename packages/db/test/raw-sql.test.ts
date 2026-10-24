import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Revisión estática (specs/REVISION-FASE-1.md H4): solo withTenant fija app.company_id. Si el código
// de la aplicación pudiera llamar set_config, o usar SQL crudo *Unsafe, podría leer como otra
// empresa saltándose la capa 2 (RLS).

const ROOT = join(import.meta.dirname, '../../..');
const ALLOWED = new Set(['packages/db/src/tenant.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'generated' || name === 'dist' || name === '.next') {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = ['apps', 'packages'].flatMap((top) =>
  readdirSync(join(ROOT, top)).flatMap((pkg) => {
    const src = join(ROOT, top, pkg, 'src');
    try {
      return statSync(src).isDirectory() ? sources(src) : [];
    } catch {
      return [];
    }
  }),
);

describe('SQL crudo en el código de la aplicación', () => {
  it('revisa los fuentes de todas las apps y paquetes', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each([
    ['set_config', /set_config/],
    ['app.company_id en SQL', /current_setting\(\s*'app\.company_id'|SET\s+(LOCAL\s+)?app\./i],
    ['$executeRawUnsafe / $queryRawUnsafe', /\$(executeRaw|queryRaw)Unsafe\s*\(/],
  ])('nadie fuera de withTenant usa %s', (_name, pattern) => {
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((f) => !ALLOWED.has(f) && pattern.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

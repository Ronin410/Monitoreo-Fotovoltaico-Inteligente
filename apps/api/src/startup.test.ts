import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
const appDir = fileURLToPath(new URL('..', import.meta.url));

describe('arranque de pv-api', () => {
  it('termina con código 1 y un mensaje claro si falta una variable obligatoria', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entry], {
      cwd: appDir,
      env: { PATH: process.env.PATH, JWT_SECRET: 'x'.repeat(40) },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Configuración inválida');
    expect(result.stderr).toContain('DATABASE_URL: es obligatoria');
    expect(result.stderr).not.toContain('x'.repeat(40));
  });
});

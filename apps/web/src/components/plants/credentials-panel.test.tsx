import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Plant } from '@/lib/inventory';
import { CredentialsPanel } from './credentials-panel';

const calls: { path: string; body?: unknown }[] = [];
const api = vi.fn(
  async (path: string, schema: { parse: (v: unknown) => unknown }, opts?: { body?: unknown }) => {
    calls.push({ path, body: opts?.body });
    if (path.endsWith('/test'))
      return schema.parse({
        ok: false,
        message: 'No se pudo conectar con el proveedor.',
        tested_at: '2026-10-23T18:00:00Z',
      });
    return schema.parse({
      has_credentials: true,
      provider: 'goodwe',
      updated_at: '2026-10-23T17:00:00Z',
      last_test_at: null,
      last_test_ok: null,
    });
  },
);
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ api }) }));

const plant = {
  id: '00000000-0000-4000-8000-000000000001',
  inverter_brand: 'goodwe',
  credentials: {
    has_credentials: false,
    provider: null,
    updated_at: null,
    last_test_at: null,
    last_test_ok: null,
  },
} as unknown as Plant;

describe('credenciales del inversor (solo escritura)', () => {
  it('guarda usuario, contraseña y campos extra, y luego no muestra nada de lo guardado', async () => {
    const onSaved = vi.fn();
    render(<CredentialsPanel plant={plant} timezone="America/Mazatlan" onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Usuario del portal'), 'instalador');
    await userEvent.type(screen.getByLabelText('Contraseña del portal'), 'S3creta!');
    await userEvent.click(screen.getByRole('button', { name: 'Campo adicional' }));
    await userEvent.type(screen.getByLabelText('Campo'), 'station_id');
    await userEvent.type(screen.getByLabelText('Valor'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar credenciales' }));

    expect(calls.at(-1)).toEqual({
      path: `/plants/${plant.id}/credentials`,
      body: { credentials: { username: 'instalador', password: 'S3creta!', station_id: '12345' } },
    });
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText(/Credenciales guardadas \(cifradas\)/)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('S3creta!');
    expect(document.body.innerHTML).not.toContain('12345');
    expect(screen.getByText(/Guardadas el/)).toBeTruthy();
  });

  it('probar conexión muestra solo el mensaje genérico de la API', async () => {
    render(
      <CredentialsPanel
        plant={{
          ...plant,
          credentials: {
            ...plant.credentials,
            has_credentials: true,
            updated_at: '2026-10-23T17:00:00Z',
          },
        }}
        timezone="America/Mazatlan"
        onSaved={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    expect(await screen.findByText('No se pudo conectar con el proveedor.')).toBeTruthy();
    expect(screen.getByText(/Última prueba: .* · falló/)).toBeTruthy();
  });
});

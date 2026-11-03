import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportView } from './import-view';

const calls: { path: string; body?: unknown }[] = [];
let reply: object;
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api: async (
      path: string,
      schema: { parse: (v: unknown) => unknown },
      opts?: { body?: unknown },
    ) => {
      calls.push({ path, body: opts?.body });
      return schema.parse(reply);
    },
  }),
}));

const base = { rows: 3, clients_new: 1, clients_existing: 1, plants_new: 3, ignored_columns: [] };
const file = () => new File(['cliente,planta\nA,B'], 'plantas.csv', { type: 'text/csv' });

describe('importar plantas desde Excel', () => {
  it('revisa, muestra los errores por renglón y no ofrece importar', async () => {
    reply = {
      ...base,
      imported: false,
      errors: [{ row: 3, column: 'capacidad_kwp', message: '"cinco" no es un número' }],
    };
    render(<ImportView />);
    expect(screen.getByRole('link', { name: /Descargar plantilla/ }).getAttribute('href')).toBe(
      '/plantilla-importacion-plantas.csv',
    );
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), file());
    await userEvent.click(screen.getByRole('button', { name: /Revisar archivo/ }));
    expect(calls.at(-1)?.path).toBe('/plants/import?dry_run=true');
    const table = await screen.findByRole('table', { name: 'Problemas del archivo' });
    expect(within(table).getByText('"cinco" no es un número')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Importar 3 plantas/ })).toBeNull();
  });

  it('sin errores, importa con confirmación', async () => {
    reply = { ...base, imported: false, errors: [] };
    render(<ImportView />);
    await userEvent.upload(screen.getByLabelText('Archivo CSV'), file());
    await userEvent.click(screen.getByRole('button', { name: /Revisar archivo/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Importar 3 plantas' }));
    reply = { ...base, imported: true, errors: [] };
    await userEvent.click(screen.getByRole('button', { name: 'Sí, importar' }));
    expect(calls.at(-1)?.path).toBe('/plants/import');
    expect(await screen.findByText(/Se importaron 3 plantas y 1 cliente nuevo/)).toBeTruthy();
  });
});

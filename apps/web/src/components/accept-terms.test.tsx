import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AcceptTerms } from './accept-terms';

const calls: { path: string; body?: unknown }[] = [];
const reload = vi.fn(async () => {});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    api: async (path: string, _s: unknown, opts?: { body?: unknown }) => {
      calls.push({ path, body: opts?.body });
    },
    reload,
    logout: vi.fn(),
  }),
}));

describe('aceptación de términos (plan 3.5)', () => {
  it('solo deja continuar al marcar la casilla y registra la versión', async () => {
    render(<AcceptTerms version="2026-11-03" />);
    expect(screen.getByRole('link', { name: 'Términos de uso' }).getAttribute('href')).toBe(
      '/terminos',
    );
    const submit = screen.getByRole('button', { name: 'Aceptar y continuar' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(submit);
    expect(calls).toEqual([{ path: '/me/accept-terms', body: { version: '2026-11-03' } }]);
    expect(reload).toHaveBeenCalled();
  });
});

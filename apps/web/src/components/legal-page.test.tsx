import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE, TERMS } from '@/content/legal';
import { AuthCard } from './auth-card';
import { LegalPage } from './legal-page';

describe('aviso de privacidad y términos (F10-T5)', () => {
  it('el aviso muestra el borrador, las secciones de la LFPDPPP y enlaza los términos', () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/revisión legal/);
    for (const h of [
      'Quién es responsable',
      'Qué datos',
      'Para qué',
      'Con quién',
      'derechos \\(ARCO\\)',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(h) })).toBeTruthy();
    }
    // Lo que promete el aviso coincide con la plataforma: la IA no recibe datos de contacto.
    expect(screen.getByText(/nunca teléfonos, correos, domicilios ni credenciales/)).toBeTruthy();
    expect(screen.getByText(/13 meses/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Términos de uso' }).getAttribute('href')).toBe(
      '/terminos',
    );
  });

  it('los términos se muestran con su versión', () => {
    render(<LegalPage doc={TERMS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Términos de uso' })).toBeTruthy();
    expect(screen.getByText(/Versión 0\.1/)).toBeTruthy();
  });

  it('las pantallas de acceso enlazan ambos documentos', () => {
    render(
      <AuthCard title="Iniciar sesión">
        <p>formulario</p>
      </AuthCard>,
    );
    expect(screen.getByRole('link', { name: 'Aviso de privacidad' }).getAttribute('href')).toBe(
      '/privacidad',
    );
    expect(screen.getByRole('link', { name: 'Términos de uso' })).toBeTruthy();
  });
});

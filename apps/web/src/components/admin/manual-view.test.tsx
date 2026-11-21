import { DEFAULT_SETTINGS } from '@pv/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ManualView } from './manual-view';

describe('manual del superadministrador', () => {
  it('muestra todas las secciones con su índice', () => {
    render(<ManualView />);
    const nav = screen.getByRole('navigation', { name: 'Secciones del manual' });
    expect(within(nav).getAllByRole('link')).toHaveLength(8);
    for (const title of [
      'De dónde salen los datos',
      'Cálculo diario',
      'Alertas',
      'Qué se puede configurar',
      'Estándares y referencias',
    ]) {
      expect(screen.getByRole('heading', { name: new RegExp(title) })).toBeTruthy();
    }
  });

  it('calcula el ejemplo del spec 05 con las funciones del motor (caso A)', () => {
    render(<ManualView />);
    // T_celda 66.125 °C, F_temp 0.8355, PR 71 %, PR corregido 85 %.
    expect(screen.getByText(/T_celda = 66\.1 °C, F_temp = 0\.836/)).toBeTruthy();
    expect(screen.getByText(/PR corregido = 85 %/)).toBeTruthy();
    // Caso C: 94 %, −0.3 %/día, umbral 88 → 20 días.
    expect(screen.getByText('20 días')).toBeTruthy();
  });

  it('los umbrales salen de los valores por defecto y de su validación', () => {
    render(<ManualView />);
    const row = screen.getByRole('row', { name: /^Caída brusca 40 %/ });
    expect(row.textContent).toContain(`${DEFAULT_SETTINGS.thresholds.sudden_drop_pct} %`);
    expect(row.textContent).toContain('5 – 100');
    expect(screen.getByRole('row', { name: /^Tarifa \$3\.50\/kWh/ }).textContent).toContain(
      'mayor a 0, hasta 1,000',
    );
  });
});

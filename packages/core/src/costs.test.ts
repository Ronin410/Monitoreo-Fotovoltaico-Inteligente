import { describe, expect, it } from 'vitest';
import { aiCost, companyMonthlyCost, costPricesSchema, type CostPrices } from './costs.js';

// Precios de ejemplo para las pruebas (no son los reales: esos van en el archivo del equipo).
const prices: CostPrices = costPricesSchema.parse({
  reviewed_at: '2026-11-03',
  models: {
    chat: { input_per_mtok: 2, output_per_mtok: 10 },
    fast: { input_per_mtok: 0.1, output_per_mtok: 0.5 },
  },
  fixed_monthly: { servidores: 60, base: 20, clima: 20 },
  email_per_1000: 1,
  storage_per_gb_month: 0.02,
});

describe('costo de IA', () => {
  it('suma entrada y salida por millón de tokens según el modelo', () => {
    const r = aiCost(
      [
        { model: 'chat', inputTokens: 1_000_000, outputTokens: 100_000 },
        { model: 'fast', inputTokens: 2_000_000, outputTokens: 400_000 },
      ],
      prices,
    );
    // chat: 2 + 1 = 3; fast: 0.2 + 0.2 = 0.4
    expect(r.total).toBeCloseTo(3.4, 10);
    expect(r.unpriced).toEqual([]);
  });

  it('reporta los modelos sin precio en lugar de inventar uno', () => {
    const r = aiCost(
      [
        { model: 'otro', inputTokens: 10, outputTokens: 0 },
        { model: 'sin-uso', inputTokens: 0, outputTokens: 0 },
      ],
      prices,
    );
    expect(r).toEqual({ total: 0, unpriced: ['otro'] });
  });
});

describe('costo mensual por empresa', () => {
  it('reparte los fijos por plantas y suma lo variable', () => {
    const cost = companyMonthlyCost(
      {
        plants: 25,
        ai: [{ model: 'chat', inputTokens: 500_000, outputTokens: 50_000 }],
        emails: 3000,
        storageBytes: 2 * 1024 ** 3,
      },
      prices,
      100,
    );
    expect(cost).toEqual({
      ai: 1.5,
      emails: 3,
      storage: 0.04,
      fixedShare: 25,
      total: 29.54,
      perPlant: 1.18,
      unpricedModels: [],
    });
  });

  it('una empresa sin plantas no absorbe fijos ni tiene costo por planta', () => {
    const cost = companyMonthlyCost({ plants: 0, ai: [], emails: 0, storageBytes: 0 }, prices, 0);
    expect(cost).toMatchObject({ fixedShare: 0, total: 0, perPlant: null });
  });

  it('valida el archivo de precios', () => {
    expect(costPricesSchema.safeParse({ ...prices, email_per_1000: -1 }).success).toBe(false);
  });
});

import { z } from 'zod';

// Costo mensual por empresa (docs/costos.md, plan de lanzamiento 5.1). Funciones puras: el
// consumo lo mide `pnpm costs:report` y los precios los captura el equipo en un archivo JSON,
// porque cambian y dependen del plan contratado de cada proveedor.

const usd = z.number().nonnegative();

export const costPricesSchema = z.object({
  /** Fecha en que se revisaron los precios (para saber si hay que actualizarlos). */
  reviewed_at: z.string(),
  /** USD por millón de tokens, por modelo. */
  models: z.record(z.string(), z.object({ input_per_mtok: usd, output_per_mtok: usd })),
  /**
   * Costos fijos de la plataforma al mes (Render: servicios y base; planes de clima y mapas).
   * Se reparten entre las empresas en proporción a sus plantas.
   */
  fixed_monthly: z.record(z.string(), usd),
  /** USD por cada 1,000 correos (por encima de lo incluido en el plan de correo). */
  email_per_1000: usd,
  /** USD por GB al mes de almacenamiento de archivos. */
  storage_per_gb_month: usd,
});
export type CostPrices = z.infer<typeof costPricesSchema>;

export type AiUsage = { model: string; inputTokens: number; outputTokens: number };

export type CompanyUsage = {
  plants: number;
  ai: AiUsage[];
  emails: number;
  storageBytes: number;
};

export type CompanyCost = {
  ai: number;
  emails: number;
  storage: number;
  /** Parte de los costos fijos que le toca por sus plantas. */
  fixedShare: number;
  total: number;
  /** null si la empresa no tiene plantas. */
  perPlant: number | null;
  /** Modelos usados que no tienen precio en el archivo (su costo cuenta como 0). */
  unpricedModels: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Costo de IA en USD; los modelos sin precio se reportan aparte. */
export function aiCost(usage: AiUsage[], prices: CostPrices) {
  let total = 0;
  const unpriced = new Set<string>();
  for (const u of usage) {
    const p = prices.models[u.model];
    if (!p) {
      if (u.inputTokens + u.outputTokens > 0) unpriced.add(u.model);
      continue;
    }
    total += (u.inputTokens * p.input_per_mtok + u.outputTokens * p.output_per_mtok) / 1_000_000;
  }
  return { total, unpriced: [...unpriced].sort() };
}

export const fixedMonthlyTotal = (prices: CostPrices) =>
  Object.values(prices.fixed_monthly).reduce((a, b) => a + b, 0);

/**
 * Costo mensual de una empresa en USD. `totalPlants` son las plantas de toda la plataforma: los
 * costos fijos se reparten por plantas (una empresa sin plantas no absorbe costos fijos).
 */
export function companyMonthlyCost(
  usage: CompanyUsage,
  prices: CostPrices,
  totalPlants: number,
): CompanyCost {
  const ai = aiCost(usage.ai, prices);
  const emails = (usage.emails / 1000) * prices.email_per_1000;
  const storage = (usage.storageBytes / 1024 ** 3) * prices.storage_per_gb_month;
  const fixedShare = totalPlants > 0 ? (fixedMonthlyTotal(prices) * usage.plants) / totalPlants : 0;
  const total = ai.total + emails + storage + fixedShare;
  return {
    ai: round(ai.total),
    emails: round(emails),
    storage: round(storage),
    fixedShare: round(fixedShare),
    total: round(total),
    perPlant: usage.plants > 0 ? round(total / usage.plants) : null,
    unpricedModels: ai.unpriced,
  };
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdapterRegistry } from './index.js';
import { NotImplementedError } from './types.js';

const plant = {
  id: 'p',
  capacityKwp: 5,
  serial: null,
  lat: 24.8,
  lon: -107.39,
  simulationProfile: null,
  noctC: 45,
  gammaPctPerC: -0.4,
  timezone: 'America/Mazatlan',
};

describe('adaptadores de marcas reales (F3-T5)', () => {
  const registry = createAdapterRegistry();

  for (const brand of ['goodwe', 'huawei', 'fronius', 'enphase', 'other'] as const) {
    it(`${brand} lanza NotImplementedError hasta tener documentación oficial`, async () => {
      const adapter = registry[brand];
      expect(adapter.provider).toBe(brand);
      await expect(adapter.testConnection({})).rejects.toBeInstanceOf(NotImplementedError);
      await expect(
        adapter.fetchReadings({ plant, creds: {}, since: new Date(), until: new Date() }),
      ).rejects.toThrow(/documentación oficial/);
    });
  }

  for (const brand of ['goodwe', 'huawei', 'fronius', 'enphase']) {
    it(`${brand}.ts exige la documentación oficial en su TODO`, () => {
      const source = readFileSync(new URL(`./${brand}.ts`, import.meta.url), 'utf8');
      expect(source).toContain(`TODO(${brand}): implementar SOLO con la documentación oficial`);
    });
  }
});

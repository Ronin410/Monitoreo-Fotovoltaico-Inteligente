import { describe, expect, it } from 'vitest';
import { telemetryRetentionStart } from './retention.js';

describe('retención de telemetría', () => {
  it('conserva desde el mismo día de hace 13 meses', () => {
    expect(telemetryRetentionStart('2026-10-24')).toBe('2025-09-24');
    expect(telemetryRetentionStart('2026-01-05')).toBe('2024-12-05');
  });

  it('ajusta al último día del mes cuando no existe', () => {
    expect(telemetryRetentionStart('2027-03-31')).toBe('2026-02-28');
    expect(telemetryRetentionStart('2029-03-30')).toBe('2028-02-29');
    expect(telemetryRetentionStart('2026-12-31', 1)).toBe('2026-11-30');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeReadings } from './telemetry.js';

const at = (hhmm: string, day = '2026-10-20') => new Date(`${day}T${hhmm}:00Z`);

describe('normalizeReadings', () => {
  it('agrupa en intervalos de 15 min y promedia la potencia', () => {
    const out = normalizeReadings([
      { ts: at('18:00'), powerKw: 3 },
      { ts: at('18:05'), powerKw: 4 },
      { ts: at('18:10'), powerKw: 5 },
      { ts: at('18:16'), powerKw: 2 },
    ]);
    expect(out.map((i) => [i.ts.toISOString(), i.powerKw])).toEqual([
      ['2026-10-20T18:00:00.000Z', 4],
      ['2026-10-20T18:15:00.000Z', 2],
    ]);
  });

  it('sin contador usa potencia × 0.25 h', () => {
    const out = normalizeReadings([{ ts: at('18:00'), powerKw: 4 }]);
    expect(out[0]?.energyKwh).toBe(1);
  });

  it('con contador diario usa la diferencia contra el intervalo anterior', () => {
    const out = normalizeReadings(
      [
        { ts: at('18:15'), powerKw: 4, energyTodayKwh: 10.9 },
        { ts: at('18:30'), powerKw: 4, energyTodayKwh: 11.8 },
      ],
      { ts: at('18:00'), energyTodayKwh: 10 },
    );
    expect(out.map((i) => i.energyKwh)).toEqual([0.9, 0.9]);
    expect(out.every((i) => !i.filled)).toBe(true);
  });

  it('el primer intervalo sin anterior usa la potencia', () => {
    const out = normalizeReadings([
      { ts: at('15:00'), powerKw: 2, energyTodayKwh: 0.5 },
      { ts: at('15:15'), powerKw: 2, energyTodayKwh: 1.1 },
    ]);
    expect(out.map((i) => i.energyKwh)).toEqual([0.5, 0.6]);
  });

  it('si el contador baja (reinicio a medianoche) toma el valor actual', () => {
    const out = normalizeReadings(
      [{ ts: at('07:00', '2026-10-21'), powerKw: 0.2, energyTodayKwh: 0.05 }],
      { ts: at('06:45', '2026-10-21'), energyTodayKwh: 42.7 },
    );
    expect(out[0]?.energyKwh).toBe(0.05);
  });

  it('reparte la diferencia en un hueco de hasta 1 hora', () => {
    const out = normalizeReadings([{ ts: at('19:00'), powerKw: 4, energyTodayKwh: 14 }], {
      ts: at('18:00'),
      energyTodayKwh: 10,
    });
    expect(out.map((i) => [i.ts.toISOString().slice(11, 16), i.energyKwh, i.filled])).toEqual([
      ['18:15', 1, true],
      ['18:30', 1, true],
      ['18:45', 1, true],
      ['19:00', 1, false],
    ]);
    expect(out.reduce((s, i) => s + i.energyKwh, 0)).toBe(4);
  });

  it('con un hueco mayor a 1 hora usa la potencia y no rellena', () => {
    const out = normalizeReadings([{ ts: at('20:00'), powerKw: 4, energyTodayKwh: 20 }], {
      ts: at('18:00'),
      energyTodayKwh: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ energyKwh: 1, filled: false });
  });

  it('si el intervalo actual no trae contador usa la potencia', () => {
    const out = normalizeReadings(
      [
        { ts: at('18:15'), powerKw: 4, energyTodayKwh: null },
        { ts: at('18:30'), powerKw: 4, energyTodayKwh: 12 },
      ],
      { ts: at('18:00'), energyTodayKwh: 10 },
    );
    // 18:15 sin contador → 1 kWh por potencia; 18:30 no tiene anterior con contador → potencia.
    expect(out.map((i) => i.energyKwh)).toEqual([1, 1]);
  });

  it('ignora lecturas no finitas, no da energía negativa y promedia temperatura y último estado', () => {
    const out = normalizeReadings([
      { ts: at('18:00'), powerKw: Number.NaN },
      { ts: at('18:01'), powerKw: -0.3, inverterTempC: 40, statusCode: 'ok' },
      { ts: at('18:02'), powerKw: 0.1, inverterTempC: 44, statusCode: 'warn' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ energyKwh: 0, inverterTempC: 42, statusCode: 'warn' });
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { addDays } from '../time.js';
import {
  buildEvidence,
  evaluateDailyAlerts,
  evaluateOffline,
  sunHoursBetween,
  zoneEventPlants,
  type AlertDay,
  type DailyAlertInput,
  type ZonePlantDay,
} from './index.js';

const T = DEFAULT_SETTINGS.thresholds;
const START = '2026-10-01';

/** Serie diaria desde START: un número es un día válido con esa desviación; un objeto, el día completo. */
function series(values: (number | Partial<AlertDay>)[]): AlertDay[] {
  return values.map((v, i) => ({
    date: addDays(START, i),
    isValidDay: true,
    deviationPct: typeof v === 'number' ? v : 0,
    neighborIndex: null,
    rainMm: 0,
    zoneEvent: false,
    soilingSlopePctPerDay: null,
    daysToCleaning: null,
    predictionConfidence: null,
    ...(typeof v === 'number' ? {} : v),
  }));
}

function evaluate(days: AlertDay[], over: Partial<DailyAlertInput> = {}) {
  return evaluateDailyAlerts({
    today: days.at(-1)!.date,
    days,
    events: [],
    open: {},
    thresholds: T,
    ...over,
  });
}

const day = (i: number) => addDays(START, i);
const cloudy = (deviationPct: number): Partial<AlertDay> => ({ isValidDay: false, deviationPct });

describe('evento de zona (specs/06 §1)', () => {
  const plant = (
    id: string,
    deviationPct: number,
    over: Partial<ZonePlantDay> = {},
  ): ZonePlantDay => ({
    plantId: id,
    postalCode: '80000',
    lat: null,
    lon: null,
    isValidDay: true,
    deviationPct,
    ...over,
  });

  it('marca a todo el grupo si al menos 60 % de sus plantas bajan más del umbral', () => {
    const marked = zoneEventPlants(
      [plant('a', 20), plant('b', 18), plant('c', 15), plant('d', 1)],
      T,
    );
    expect([...marked].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('exactamente 60 % (3 de 5) ya es evento de zona', () => {
    const days = [plant('a', 20), plant('b', 18), plant('c', 13), plant('d', 1), plant('e', 2)];
    expect(zoneEventPlants(days, T).size).toBe(5);
  });

  it('no marca con menos de 60 % ni con menos plantas que el mínimo de vecinas', () => {
    expect(
      zoneEventPlants([plant('a', 20), plant('b', 18), plant('c', 1), plant('d', 1)], T).size,
    ).toBe(0);
    expect(zoneEventPlants([plant('a', 20), plant('b', 18)], T).size).toBe(0);
  });

  it('los días no válidos no forman parte del grupo', () => {
    const days = [
      plant('a', 20),
      plant('b', 18),
      plant('c', 30, { isValidDay: false }),
      plant('d', 1),
    ];
    // Grupo válido: a, b, d (67 % bajan) → se marca; c no cuenta.
    expect([...zoneEventPlants(days, T)].sort()).toEqual(['a', 'b', 'd']);
    const fewValid = [plant('a', 20), plant('b', 30, { isValidDay: false }), plant('c', 1)];
    expect(zoneEventPlants(fewValid, T).size).toBe(0);
  });

  it('también agrupa por radio entre códigos postales distintos', () => {
    const at = (id: string, cp: string, lat: number, deviationPct: number) =>
      plant(id, deviationPct, { postalCode: cp, lat, lon: -107.39 });
    const days = [
      at('a', '1', 24.8, 20),
      at('b', '2', 24.81, 20),
      at('c', '3', 24.82, 20),
      at('lejos', '4', 25.5, 20),
    ];
    expect([...zoneEventPlants(days, T)].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('sudden_drop', () => {
  it('crítica: ≥ 40 % y el día válido anterior < 15 %', () => {
    expect(evaluate(series([1, 2, 1, 45]))).toEqual([
      {
        kind: 'open',
        type: 'sudden_drop',
        severity: 'critical',
        trigger: { dates: [day(2), day(3)], deviation_pct: [1, 45] },
      },
    ]);
  });

  it('no es crítica si el día anterior ya venía bajo (≥ 15 %)', () => {
    expect(evaluate(series([1, 16, 45]))).toEqual([]);
  });

  it('falla de 1 de 3 strings (33 %) dispara la advertencia tras 2 días', () => {
    const days = series([
      1,
      2,
      { deviationPct: 33, neighborIndex: 0.67 },
      { deviationPct: 33, neighborIndex: 0.67 },
    ]);
    expect(evaluate(days.slice(0, 3))).toEqual([]);
    expect(evaluate(days)).toEqual([
      {
        kind: 'open',
        type: 'sudden_drop',
        severity: 'warning',
        trigger: { dates: [day(1), day(2), day(3)], deviation_pct: [2, 33, 33] },
      },
    ]);
  });

  it('la advertencia exige vecinas por debajo de 0.8 (o sin vecinas) y un día previo < 10 %', () => {
    const withNeighbors = (index: number | null) =>
      series([
        1,
        2,
        { deviationPct: 33, neighborIndex: index },
        { deviationPct: 33, neighborIndex: index },
      ]);
    expect(evaluate(withNeighbors(0.95))).toEqual([]);
    expect(evaluate(withNeighbors(null))[0]).toMatchObject({ kind: 'open', severity: 'warning' });
    expect(evaluate(series([1, 12, 33, 33]))).toEqual([]);
  });

  it('un día nublado (no válido) no dispara y se salta al buscar el día anterior', () => {
    expect(evaluate(series([1, 2, cloudy(70)]))).toEqual([]);
    expect(evaluate(series([1, 2, cloudy(70), 45]))[0]).toMatchObject({
      kind: 'open',
      severity: 'critical',
      trigger: { dates: [day(1), day(3)] },
    });
  });

  it('un evento de zona suprime la alerta', () => {
    expect(evaluate(series([1, 2, { deviationPct: 45, zoneEvent: true }]))).toEqual([]);
  });

  it('solo dispara si el último día válido es la fecha evaluada', () => {
    const days = series([1, 2, 45, cloudy(10)]);
    expect(evaluate(days)).toEqual([]);
  });

  it('con alerta abierta actualiza (y sube la severidad) y se resuelve con 2 días < 10 %', () => {
    const open = { sudden_drop: { severity: 'warning' as const, detectedOn: day(3) } };
    expect(evaluate(series([1, 2, 33, 33, 32]), { open })).toEqual([
      { kind: 'update', type: 'sudden_drop', severity: 'warning' },
    ]);
    expect(evaluate(series([1, 2, 33, 1, 45]), { open })[0]).toMatchObject({
      kind: 'update',
      severity: 'critical',
      trigger: { dates: [day(3), day(4)] },
    });
    expect(evaluate(series([1, 2, 33, 33, 3]), { open })[0]).toMatchObject({ kind: 'update' });
    expect(evaluate(series([1, 2, 33, 33, 3, cloudy(50), 4]), { open })).toEqual([
      { kind: 'resolve', type: 'sudden_drop', reason: 'recovered' },
    ]);
  });
});

describe('soiling', () => {
  const dirty = (deviationPct: number, over: Partial<AlertDay> = {}): Partial<AlertDay> => ({
    deviationPct,
    soilingSlopePctPerDay: -0.4,
    ...over,
  });

  it('abre con 3 días válidos seguidos sobre 12 % y tendencia descendente', () => {
    expect(evaluate(series([3, dirty(13), dirty(14), dirty(15)]))).toEqual([
      {
        kind: 'open',
        type: 'soiling',
        severity: 'warning',
        trigger: { dates: [day(1), day(2), day(3)], deviation_pct: [13, 14, 15] },
      },
    ]);
  });

  it('los días nublados no rompen la racha, pero debe caber en 7 días', () => {
    const gap = (n: number) => Array.from({ length: n }, () => cloudy(40));
    expect(evaluate(series([dirty(13), ...gap(2), dirty(14), dirty(15)]))[0]).toMatchObject({
      type: 'soiling',
    });
    expect(evaluate(series([dirty(13), ...gap(5), dirty(14), dirty(15)]))).toEqual([]);
  });

  it('no abre si llovió lo suficiente en la racha, ni con tendencia plana', () => {
    expect(evaluate(series([dirty(13), { ...dirty(14), rainMm: 3 }, dirty(15)]))).toEqual([]);
    expect(evaluate(series([dirty(13, { rainMm: 1 }), dirty(14), dirty(15)]))[0]).toMatchObject({
      type: 'soiling',
    });
    expect(evaluate(series([13, 14, { deviationPct: 15, soilingSlopePctPerDay: 0 }]))).toEqual([]);
  });

  it('sin pendiente calculable abre solo si no hay caída brusca', () => {
    expect(evaluate(series([13, 14, 15]))[0]).toMatchObject({ type: 'soiling', kind: 'open' });
    // 1 → 45 es caída brusca: no es suciedad.
    const actions = evaluate(series([1, 45, 45, 45]), {
      open: { sudden_drop: { severity: 'critical', detectedOn: day(1) } },
    });
    expect(actions.map((a) => a.type)).toEqual(['sudden_drop']);
    // Tampoco con pendiente negativa: la caída inclina la recta (#103).
    const sloped = evaluate(series([1, dirty(45), dirty(45), dirty(45)]), {
      open: { sudden_drop: { severity: 'critical', detectedOn: day(1) } },
    });
    expect(sloped.map((a) => a.type)).toEqual(['sudden_drop']);
  });

  it('un evento de zona no cuenta para la racha', () => {
    expect(evaluate(series([dirty(13), dirty(14), dirty(15, { zoneEvent: true })]))).toEqual([]);
  });

  const open = { soiling: { severity: 'warning' as const, detectedOn: day(3) } };
  const base = [3, dirty(13), dirty(14), dirty(15)];

  it('se resuelve si tras un lavado el siguiente día válido baja de 5 %', () => {
    const events = [{ type: 'cleaning', date: day(4) }];
    expect(evaluate(series([...base, dirty(12), cloudy(0), 2]), { open, events })).toEqual([
      { kind: 'resolve', type: 'soiling', reason: 'cleaning_recovered' },
    ]);
  });

  it('lavado que no recupera: se mantiene abierta, marca la evidencia y pide nueva explicación', () => {
    const events = [{ type: 'cleaning', date: day(4) }];
    const days = series([...base, dirty(15), dirty(14), dirty(13)]);
    expect(evaluate(days, { open, events })).toEqual([
      {
        kind: 'update',
        type: 'soiling',
        severity: 'warning',
        trigger: { dates: [day(4), day(5), day(6)], deviation_pct: [15, 14, 13] },
        cleaningDidNotRecover: true,
        reexplain: true,
      },
    ]);
    // Ya marcada: conserva la marca y no vuelve a pedir explicación.
    const again = evaluate(series([...base, dirty(15), dirty(14), dirty(13), dirty(13)]), {
      open: { soiling: { ...open.soiling, cleaningDidNotRecover: true } },
      events,
    });
    expect(again[0]).toMatchObject({ kind: 'update', cleaningDidNotRecover: true });
    expect(again[0]).not.toHaveProperty('reexplain');
  });

  it('también se resuelve con 2 días válidos bajo 5 % sin lavado', () => {
    expect(evaluate(series([...base, 4, 3]), { open })).toEqual([
      { kind: 'resolve', type: 'soiling', reason: 'recovered' },
    ]);
    expect(evaluate(series([...base, 4, 6]), { open })[0]).toMatchObject({ kind: 'update' });
  });
});

describe('cleaning_due_soon', () => {
  const due = (
    daysToCleaning: number,
    predictionConfidence: AlertDay['predictionConfidence'] = 'medium',
  ) => ({
    deviationPct: 8,
    soilingSlopePctPerDay: -0.5,
    daysToCleaning,
    predictionConfidence,
  });

  it('abre con 1 a 7 días para el lavado y confianza media o alta', () => {
    expect(evaluate(series([1, due(5)]))).toEqual([
      {
        kind: 'open',
        type: 'cleaning_due_soon',
        severity: 'info',
        trigger: { dates: [day(1)], deviation_pct: [8] },
      },
    ]);
    expect(evaluate(series([1, due(7, 'high')]))[0]).toMatchObject({ type: 'cleaning_due_soon' });
    expect(evaluate(series([1, due(5, 'low')]))).toEqual([]);
    expect(evaluate(series([1, due(0)]))).toEqual([]);
    expect(evaluate(series([1, due(8)]))).toEqual([]);
  });

  it('no abre con soiling abierta ni con una caída brusca activa (#103)', () => {
    const soilingOpen = { soiling: { severity: 'warning' as const, detectedOn: day(0) } };
    expect(evaluate(series([13, due(5)]), { open: soilingOpen }).map((a) => a.type)).toEqual([
      'soiling',
    ]);
    const drop = evaluate(series([1, 2, { ...due(3), deviationPct: 45 }]));
    expect(drop.map((a) => a.type)).toEqual(['sudden_drop']);
  });

  it('se resuelve al abrirse soiling o con un evento de limpieza', () => {
    const open = { cleaning_due_soon: { severity: 'info' as const, detectedOn: day(1) } };
    const toSoiling = evaluate(
      series([
        1,
        due(3),
        { ...due(2), deviationPct: 13 },
        { ...due(1), deviationPct: 14 },
        { ...due(1), deviationPct: 15 },
      ]),
      { open },
    );
    expect(toSoiling).toEqual([
      expect.objectContaining({ kind: 'open', type: 'soiling' }),
      { kind: 'resolve', type: 'cleaning_due_soon', reason: 'soiling_opened' },
    ]);
    expect(
      evaluate(series([1, due(3), 1]), { open, events: [{ type: 'rain_cleaning', date: day(2) }] }),
    ).toEqual([{ kind: 'resolve', type: 'cleaning_due_soon', reason: 'cleaning_event' }]);
    expect(evaluate(series([1, due(3), due(2)]), { open })).toEqual([
      { kind: 'update', type: 'cleaning_due_soon', severity: 'info' },
    ]);
  });
});

describe('offline', () => {
  const CULIACAN = { lat: 24.8, lon: -107.39 };
  // 21 oct 2026 en Culiacán (UTC−7): amanece ≈ 13:20 UTC y anochece ≈ 00:50 UTC.
  const utc = (iso: string) => new Date(iso);

  it('cuenta solo horas con sol', () => {
    expect(
      sunHoursBetween(
        utc('2026-10-21T03:00:00Z'),
        utc('2026-10-21T12:00:00Z'),
        CULIACAN.lat,
        CULIACAN.lon,
      ),
    ).toBe(0);
    const day = sunHoursBetween(
      utc('2026-10-21T07:00:00Z'),
      utc('2026-10-22T07:00:00Z'),
      CULIACAN.lat,
      CULIACAN.lon,
    );
    expect(day).toBeGreaterThan(11);
    expect(day).toBeLessThan(12.5);
  });

  const input = (over: Partial<Parameters<typeof evaluateOffline>[0]> = {}) => ({
    ...CULIACAN,
    now: utc('2026-10-21T20:00:00Z'), // 13:00 local
    lastReadingAt: utc('2026-10-21T14:00:00Z'), // 07:00 local
    expectedSince: utc('2026-01-01T00:00:00Z'),
    providerError: false,
    open: undefined,
    thresholds: T,
    ...over,
  });

  it('abre crítica con más de 4 horas de sol sin lecturas', () => {
    expect(evaluateOffline(input())).toMatchObject({
      kind: 'open',
      type: 'offline',
      severity: 'critical',
    });
    expect(evaluateOffline(input({ now: utc('2026-10-21T17:00:00Z') }))).toBeNull();
  });

  it('la noche no cuenta: lectura a las 17:00 y son las 08:00 del día siguiente', () => {
    expect(
      evaluateOffline(
        input({ lastReadingAt: utc('2026-10-22T00:00:00Z'), now: utc('2026-10-22T15:00:00Z') }),
      ),
    ).toBeNull();
  });

  it('un error de nuestra integración no crea alerta', () => {
    expect(evaluateOffline(input({ providerError: true }))).toBeNull();
  });

  it('sin lecturas nunca, cuenta desde que se esperan', () => {
    expect(
      evaluateOffline(input({ lastReadingAt: null, expectedSince: utc('2026-10-21T18:00:00Z') })),
    ).toBeNull();
    expect(evaluateOffline(input({ lastReadingAt: null }))).toMatchObject({ kind: 'open' });
  });

  it('se resuelve cuando vuelve a haber lecturas', () => {
    const open = {
      severity: 'critical' as const,
      detectedOn: '2026-10-21',
      detectedAt: utc('2026-10-21T19:00:00Z'),
    };
    expect(evaluateOffline(input({ open }))).toBeNull();
    expect(evaluateOffline(input({ open, lastReadingAt: utc('2026-10-21T19:45:00Z') }))).toEqual({
      kind: 'resolve',
      type: 'offline',
      reason: 'readings_resumed',
    });
  });
});

describe('evidencia (specs/06 §3)', () => {
  it('resume disparo, base, tendencia, vecinas, clima y los últimos 14 días', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      ...series([i])[0]!,
      date: day(i),
      deviationPct: i,
      rainMm: i === 3 || i === 10 ? 5 : 0,
      prTemp: 0.9 - i / 100,
      prBaseline: 0.91,
      baselineSource: 'own' as const,
      neighborCount: 6,
      neighborIndex: 0.86,
      cloudCoverAvgPct: i >= 17 ? 10 + i : 50,
      tempAmbMaxC: 30 + i / 4,
      soilingSlopePctPerDay: -0.4213,
      daysToCleaning: 4,
      predictionConfidence: 'high' as const,
    }));
    const evidence = buildEvidence({
      rule: 'soiling',
      trigger: { dates: [day(19)], deviation_pct: [19] },
      today: day(19),
      days,
      events: [
        { type: 'rain_cleaning', date: day(3) },
        { type: 'cleaning', date: day(10) },
        { type: 'note', date: day(15) },
      ],
    });
    expect(evidence).toMatchObject({
      rule: 'soiling',
      baseline: { value: 0.91, source: 'own' },
      trend: {
        slope_pct_per_day: -0.421,
        confidence: 'high',
        days_to_cleaning: 4,
        days_since_reset: 9,
        last_reset: { type: 'cleaning', date: day(10) },
      },
      neighbors: { count: 6, neighbor_index: 0.86 },
      // Solo la lluvia del día 10 cae en los últimos 14 días (6 a 19).
      weather: { rain_mm_14d: 5, cloud_cover_avg_pct_3d: 28, temp_amb_max_c_3d: 34.8 },
      cleaning_did_not_recover: false,
    });
    expect(evidence.last_14_days.map((d) => d.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => day(i + 6)),
    );
    expect(evidence.last_14_days[0]).toEqual({
      date: day(6),
      pr_temp: 0.84,
      deviation_pct: 6,
      neighbor_index: 0.86,
      rain_mm: 0,
      valid: true,
      zone_event: false,
    });
  });
});

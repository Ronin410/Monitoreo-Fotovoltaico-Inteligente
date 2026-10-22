import { describe, expect, it } from 'vitest';
import { parseCompanySettings } from './settings.js';
import { simulationProfileSchema } from './simulation.js';

describe('parseCompanySettings', () => {
  it('aplica todos los valores por defecto de specs/03 a settings vacíos', () => {
    expect(parseCompanySettings({})).toEqual({
      thresholds: {
        soiling_deviation_pct: 12,
        soiling_consecutive_days: 3,
        sudden_drop_pct: 40,
        offline_hours: 4,
        rain_reset_mm: 2,
        min_valid_irradiation_kwh_m2: 2.0,
        min_data_completeness_pct: 80,
        neighbor_radius_km: 5,
        neighbor_min_count: 3,
        zone_event_pct: 60,
      },
      defaults: {
        noct_c: 45,
        gamma_pct_per_c: -0.4,
        tilt_deg: 20,
        azimuth_deg: 180,
        tariff_mxn_per_kwh: 3.5,
        co2_kg_per_kwh: 0.438,
      },
      notifications: { alert_emails: [], auto_send_client_reports: false },
    });
    expect(parseCompanySettings(null)).toEqual(parseCompanySettings({}));
  });

  it('respeta los valores guardados y completa el resto', () => {
    const s = parseCompanySettings({
      defaults: { tilt_deg: 15 },
      thresholds: { offline_hours: 6 },
    });
    expect(s.defaults).toMatchObject({ tilt_deg: 15, azimuth_deg: 180, noct_c: 45 });
    expect(s.thresholds).toMatchObject({ offline_hours: 6, soiling_deviation_pct: 12 });
  });

  it('rechaza valores fuera de rango', () => {
    expect(() => parseCompanySettings({ defaults: { gamma_pct_per_c: 0.4 } })).toThrow();
    expect(() => parseCompanySettings({ defaults: { tilt_deg: 95 } })).toThrow();
    expect(() => parseCompanySettings({ thresholds: { neighbor_min_count: 2.5 } })).toThrow();
  });
});

describe('simulationProfileSchema', () => {
  it('acepta el ejemplo de specs/04 §3', () => {
    const profile = simulationProfileSchema.parse({
      seed: 1234,
      system_efficiency: 0.89,
      ac_limit_kw: 9.0,
      noise_pct: 2,
      scenarios: [
        { type: 'soiling', start: '2026-08-01', rate_pct_per_day: 0.35 },
        { type: 'string_failure', start: '2026-09-14', loss_pct: 33, end: null },
        { type: 'offline', start: '2026-10-20T15:00:00Z', end: null },
        { type: 'shading', start: '2026-07-01', loss_pct: 25, local_hours: [16, 17, 18] },
      ],
    });
    expect(profile.scenarios).toHaveLength(4);
  });

  it('rechaza escenarios desconocidos o mal formados', () => {
    const base = { seed: 1, system_efficiency: 0.9, ac_limit_kw: 5 };
    expect(() =>
      simulationProfileSchema.parse({ ...base, scenarios: [{ type: 'fire' }] }),
    ).toThrow();
    expect(() =>
      simulationProfileSchema.parse({
        ...base,
        scenarios: [{ type: 'soiling', start: '01/08/2026', rate_pct_per_day: 0.3 }],
      }),
    ).toThrow();
    expect(() =>
      simulationProfileSchema.parse({
        ...base,
        scenarios: [{ type: 'shading', start: '2026-07-01', loss_pct: 25, local_hours: [24] }],
      }),
    ).toThrow();
  });
});

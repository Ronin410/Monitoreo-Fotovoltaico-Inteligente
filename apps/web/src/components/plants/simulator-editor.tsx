'use client';

import type { SimulationProfile, SimulationScenario } from '@pv/core';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';

// Editor sencillo de escenarios del simulador (specs/09 §Formulario de planta, specs/04 §3).
// Solo aparece con SIMULATOR_ENABLED (staging o demo).

const TYPES: { value: SimulationScenario['type']; label: string }[] = [
  { value: 'soiling', label: 'Suciedad' },
  { value: 'string_failure', label: 'Falla de string' },
  { value: 'offline', label: 'Sin comunicación' },
  { value: 'shading', label: 'Sombra' },
];

const today = () => new Date().toISOString().slice(0, 10);

function blank(type: SimulationScenario['type']): SimulationScenario {
  switch (type) {
    case 'soiling':
      return { type, start: today(), rate_pct_per_day: 0.5 };
    case 'string_failure':
      return { type, start: today(), loss_pct: 33, end: null };
    case 'offline':
      return { type, start: new Date().toISOString(), end: null };
    case 'shading':
      return { type, start: today(), loss_pct: 40, local_hours: [16, 17] };
  }
}

const input =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-900';

function Num({
  id,
  label,
  value,
  onChange,
  step = 'any',
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      {label}
      <input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className={input}
      />
    </label>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  type = 'date',
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      {label}
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
    </label>
  );
}

function ScenarioFields({
  s,
  i,
  onChange,
}: {
  s: SimulationScenario;
  i: number;
  onChange: (s: SimulationScenario) => void;
}) {
  const id = (f: string) => `sim-${i}-${f}`;
  switch (s.type) {
    case 'soiling':
      return (
        <>
          <Text
            id={id('start')}
            label="Desde"
            value={s.start}
            onChange={(start) => onChange({ ...s, start })}
          />
          <Num
            id={id('rate')}
            label="Pérdida por día (%)"
            value={s.rate_pct_per_day}
            onChange={(rate_pct_per_day) => onChange({ ...s, rate_pct_per_day })}
          />
        </>
      );
    case 'string_failure':
      return (
        <>
          <Text
            id={id('start')}
            label="Desde"
            value={s.start}
            onChange={(start) => onChange({ ...s, start })}
          />
          <Text
            id={id('end')}
            label="Hasta (opcional)"
            value={s.end ?? ''}
            onChange={(end) => onChange({ ...s, end: end || null })}
          />
          <Num
            id={id('loss')}
            label="Pérdida (%)"
            value={s.loss_pct}
            onChange={(loss_pct) => onChange({ ...s, loss_pct })}
          />
        </>
      );
    case 'offline':
      return (
        <>
          <Text
            id={id('start')}
            label="Desde (ISO con zona)"
            type="text"
            value={s.start}
            onChange={(start) => onChange({ ...s, start })}
          />
          <Text
            id={id('end')}
            label="Hasta (opcional)"
            type="text"
            value={s.end ?? ''}
            onChange={(end) => onChange({ ...s, end: end || null })}
          />
        </>
      );
    case 'shading':
      return (
        <>
          <Text
            id={id('start')}
            label="Desde"
            value={s.start}
            onChange={(start) => onChange({ ...s, start })}
          />
          <Num
            id={id('loss')}
            label="Pérdida (%)"
            value={s.loss_pct}
            onChange={(loss_pct) => onChange({ ...s, loss_pct })}
          />
          <Text
            id={id('hours')}
            label="Horas locales (coma)"
            type="text"
            placeholder="16, 17"
            value={s.local_hours.join(', ')}
            onChange={(v) =>
              onChange({
                ...s,
                local_hours: v
                  .split(',')
                  .map((h) => Number(h.trim()))
                  .filter((h) => Number.isInteger(h)),
              })
            }
          />
        </>
      );
  }
}

export function SimulatorEditor({
  profile,
  onChange,
  error,
}: {
  profile: SimulationProfile;
  onChange: (p: SimulationProfile) => void;
  error?: string;
}) {
  const setScenario = (i: number, s: SimulationScenario) =>
    onChange({ ...profile, scenarios: profile.scenarios.map((x, j) => (j === i ? s : x)) });
  return (
    <div className="flex flex-col gap-4 sm:col-span-2">
      {error && <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Num
          id="sim-seed"
          label="Semilla"
          step="1"
          value={profile.seed}
          onChange={(seed) => onChange({ ...profile, seed })}
        />
        <Num
          id="sim-eff"
          label="Eficiencia (0.5–1)"
          value={profile.system_efficiency}
          onChange={(system_efficiency) => onChange({ ...profile, system_efficiency })}
        />
        <Num
          id="sim-ac"
          label="Límite AC (kW)"
          value={profile.ac_limit_kw}
          onChange={(ac_limit_kw) => onChange({ ...profile, ac_limit_kw })}
        />
        <Num
          id="sim-noise"
          label="Ruido (%)"
          value={profile.noise_pct}
          onChange={(noise_pct) => onChange({ ...profile, noise_pct })}
        />
      </div>
      <ul className="flex flex-col gap-3">
        {profile.scenarios.map((s, i) => (
          <li
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="flex items-end gap-2">
              <label htmlFor={`sim-${i}-type`} className="flex flex-1 flex-col gap-1 text-sm">
                Escenario
                <select
                  id={`sim-${i}-type`}
                  value={s.type}
                  onChange={(e) =>
                    setScenario(i, blank(e.target.value as SimulationScenario['type']))
                  }
                  className={input}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Quitar escenario ${i + 1}`}
                onClick={() =>
                  onChange({ ...profile, scenarios: profile.scenarios.filter((_, j) => j !== i) })
                }
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ScenarioFields s={s} i={i} onChange={(x) => setScenario(i, x)} />
            </div>
          </li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange({ ...profile, scenarios: [...profile.scenarios, blank('soiling')] })
          }
        >
          <Plus aria-hidden="true" className="size-4" /> Agregar escenario
        </Button>
      </div>
    </div>
  );
}

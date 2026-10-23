'use client';

import type { SimulationProfile } from '@pv/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Fieldset,
  fieldErrors,
  invalidNumbers,
  numberOrNull,
  SelectInput,
  textOrNull,
  TextInput,
  type FieldErrors,
} from '@/components/form';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import {
  BRAND_LABELS,
  clientsResponse,
  companyDefaultsResponse,
  INVERTER_BRAND_OPTIONS,
  LIFECYCLE_LABELS,
  plantSchema,
  type InverterBrand,
  type Plant,
} from '@/lib/inventory';
import { useApiQuery } from '@/lib/use-api';
import { SimulatorEditor } from './simulator-editor';

// Alta y edición de planta (specs/09 §Formulario de planta). Los valores técnicos vacíos toman
// los de la empresa y la ubicación vacía se copia del cliente (lo hace la API).

const HELP = {
  tilt_deg: 'Ángulo de los paneles respecto al suelo: 0° es horizontal.',
  azimuth_deg: 'Hacia dónde miran los paneles: 180° es sur, 90° este y 270° oeste.',
  noct_c:
    'Temperatura de celda en condiciones nominales. Viene en la hoja de datos del panel (típico 42 a 46 °C).',
  gamma_pct_per_c:
    'Potencia que pierde el panel por cada °C arriba de 25 °C. Hoja de datos del panel (típico −0.35 a −0.45 %/°C).',
};

function newProfile(capacity: number | null): SimulationProfile {
  return {
    seed: Math.floor(Math.random() * 1_000_000),
    system_efficiency: 0.88,
    ac_limit_kw: capacity ? Number((capacity * 0.95).toFixed(2)) : 5,
    noise_pct: 2,
    scenarios: [],
  };
}

export function PlantForm({ plant }: { plant?: Plant }) {
  const { api, state } = useAuth();
  const router = useRouter();
  const presetClient = useSearchParams().get('client_id');
  const clients = useApiQuery('/clients?page_size=100', clientsResponse);
  const company = useApiQuery('/company', companyDefaultsResponse);
  const simulatorEnabled = state.status === 'authenticated' && state.features.simulator;
  const [brand, setBrand] = useState<InverterBrand>(plant?.inverter_brand ?? 'goodwe');
  const [profile, setProfile] = useState<SimulationProfile>(
    plant?.simulation_profile ?? newProfile(plant?.capacity_kwp ?? null),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (clients.error) return <Notice tone="error">{clients.error.message}</Notice>;
  if (!clients.data) return <Spinner />;
  if (clients.data.data.length === 0) {
    return <Notice tone="info">Primero da de alta un cliente: cada planta pertenece a uno.</Notice>;
  }
  const defaults = company.data?.settings.defaults;
  const brands = INVERTER_BRAND_OPTIONS.filter(
    (b) => b !== 'simulator' || simulatorEnabled || plant?.inverter_brand === 'simulator',
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // En alta, lo vacío no se manda (toma el valor por defecto); en edición, se conserva.
    const optional = (v: number | string | null) => (v === null ? undefined : v);
    const body: Record<string, unknown> = {
      client_id: f.get('client_id'),
      name: textOrNull(f, 'name'),
      capacity_kwp: numberOrNull(f, 'capacity_kwp'),
      inverter_brand: brand,
      inverter_model: textOrNull(f, 'inverter_model'),
      inverter_serial: textOrNull(f, 'inverter_serial'),
      panel_model: textOrNull(f, 'panel_model'),
      panel_count: numberOrNull(f, 'panel_count'),
      commissioning_date: textOrNull(f, 'commissioning_date'),
      tilt_deg: optional(numberOrNull(f, 'tilt_deg')),
      azimuth_deg: optional(numberOrNull(f, 'azimuth_deg')),
      noct_c: optional(numberOrNull(f, 'noct_c')),
      gamma_pct_per_c: optional(numberOrNull(f, 'gamma_pct_per_c')),
      lat: optional(numberOrNull(f, 'lat')),
      lon: optional(numberOrNull(f, 'lon')),
      postal_code: optional(textOrNull(f, 'postal_code')),
      colonia: optional(textOrNull(f, 'colonia')),
      simulation_profile: brand === 'simulator' ? profile : null,
    };
    if (plant) body.status = f.get('status');
    const bad = invalidNumbers(f, [
      'capacity_kwp',
      'panel_count',
      'tilt_deg',
      'azimuth_deg',
      'noct_c',
      'gamma_pct_per_c',
      'lat',
      'lon',
    ]);
    if (Object.keys(bad).length > 0) {
      setErrors(bad);
      setError('Revisa los campos marcados.');
      return;
    }
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const saved = await api(plant ? `/plants/${plant.id}` : '/plants', plantSchema, {
        method: plant ? 'PATCH' : 'POST',
        body,
      });
      router.push(`/plants/${saved.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const v = (n: number | string | null | undefined) =>
    n === null || n === undefined ? undefined : String(n);
  const placeholder = (n: number | undefined) =>
    n === undefined ? undefined : `Por defecto: ${n}`;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      <Fieldset legend="Planta">
        <SelectInput
          id="client_id"
          label="Cliente"
          required
          defaultValue={plant?.client.id ?? presetClient ?? undefined}
          error={errors.client_id}
          options={clients.data.data.map((c) => ({
            value: c.id,
            label: `${c.name} · ${c.colonia}`,
          }))}
        />
        <TextInput
          id="name"
          label="Nombre de la planta"
          required
          maxLength={200}
          defaultValue={v(plant?.name)}
          error={errors.name}
        />
        <TextInput
          id="capacity_kwp"
          label="Capacidad (kWp)"
          required
          inputMode="decimal"
          defaultValue={v(plant?.capacity_kwp)}
          error={errors.capacity_kwp}
        />
        <TextInput
          id="commissioning_date"
          label="Puesta en marcha"
          type="date"
          defaultValue={v(plant?.commissioning_date)}
          error={errors.commissioning_date}
        />
        {plant && (
          <SelectInput
            id="status"
            label="Estado"
            defaultValue={plant.status}
            options={Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))}
            hint="Las plantas pausadas no se monitorean ni generan alertas."
          />
        )}
      </Fieldset>

      <Fieldset legend="Equipo">
        <SelectInput
          id="inverter_brand"
          label="Marca del inversor"
          required
          value={brand}
          onChange={(e) => setBrand(e.target.value as InverterBrand)}
          error={errors.inverter_brand}
          options={brands.map((b) => ({ value: b, label: BRAND_LABELS[b] }))}
        />
        <TextInput
          id="inverter_model"
          label="Modelo del inversor"
          defaultValue={v(plant?.inverter_model)}
          error={errors.inverter_model}
        />
        <TextInput
          id="inverter_serial"
          label="Número de serie"
          defaultValue={v(plant?.inverter_serial)}
          error={errors.inverter_serial}
        />
        <TextInput
          id="panel_model"
          label="Modelo de panel"
          defaultValue={v(plant?.panel_model)}
          error={errors.panel_model}
        />
        <TextInput
          id="panel_count"
          label="Número de paneles"
          inputMode="numeric"
          defaultValue={v(plant?.panel_count)}
          error={errors.panel_count}
        />
      </Fieldset>

      <Fieldset
        legend="Datos técnicos"
        description="Si los dejas vacíos se usan los valores por defecto de la empresa."
      >
        <TextInput
          id="tilt_deg"
          label="Inclinación (°)"
          inputMode="decimal"
          hint={HELP.tilt_deg}
          placeholder={placeholder(defaults?.tilt_deg)}
          defaultValue={v(plant?.tilt_deg)}
          error={errors.tilt_deg}
        />
        <TextInput
          id="azimuth_deg"
          label="Orientación (°)"
          inputMode="decimal"
          hint={HELP.azimuth_deg}
          placeholder={placeholder(defaults?.azimuth_deg)}
          defaultValue={v(plant?.azimuth_deg)}
          error={errors.azimuth_deg}
        />
        <TextInput
          id="noct_c"
          label="NOCT (°C)"
          inputMode="decimal"
          hint={HELP.noct_c}
          placeholder={placeholder(defaults?.noct_c)}
          defaultValue={v(plant?.noct_c)}
          error={errors.noct_c}
        />
        <TextInput
          id="gamma_pct_per_c"
          label="Coeficiente γ (%/°C)"
          inputMode="decimal"
          hint={HELP.gamma_pct_per_c}
          placeholder={placeholder(defaults?.gamma_pct_per_c)}
          defaultValue={v(plant?.gamma_pct_per_c)}
          error={errors.gamma_pct_per_c}
        />
      </Fieldset>

      <Fieldset
        legend="Ubicación"
        description="Vacío = la del cliente. Cambiar la ubicación vuelve a descargar el clima de 90 días."
      >
        <TextInput
          id="lat"
          label="Latitud"
          inputMode="decimal"
          defaultValue={v(plant?.lat)}
          error={errors.lat}
        />
        <TextInput
          id="lon"
          label="Longitud"
          inputMode="decimal"
          defaultValue={v(plant?.lon)}
          error={errors.lon}
        />
        <TextInput
          id="colonia"
          label="Colonia"
          defaultValue={v(plant?.colonia)}
          error={errors.colonia}
        />
        <TextInput
          id="postal_code"
          label="Código postal"
          inputMode="numeric"
          maxLength={5}
          defaultValue={v(plant?.postal_code)}
          error={errors.postal_code}
        />
      </Fieldset>

      {brand === 'simulator' && (
        <Fieldset
          legend="Simulador"
          description="Inversor simulado para demos y staging: genera lecturas a partir del clima con estos escenarios."
        >
          <SimulatorEditor
            profile={profile}
            onChange={setProfile}
            error={errors.simulation_profile}
          />
        </Fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : plant ? 'Guardar cambios' : 'Crear planta'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

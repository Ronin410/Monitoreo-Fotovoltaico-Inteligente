'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Fieldset,
  fieldErrors,
  invalidNumbers,
  numberOrNull,
  textOrNull,
  TextInput,
  type FieldErrors,
} from '@/components/form';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { clientSchema, type Client } from '@/lib/inventory';

const LocationPicker = dynamic(() => import('@/components/location-picker'), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
});

/** Alta y edición de cliente (specs/09 §Clientes). */
export function ClientForm({ client }: { client?: Client }) {
  const { api } = useAuth();
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState<number | null>(client?.lat ?? null);
  const [lon, setLon] = useState<number | null>(client?.lon ?? null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: textOrNull(f, 'name'),
      contact_name: textOrNull(f, 'contact_name'),
      phone: textOrNull(f, 'phone'),
      email: textOrNull(f, 'email'),
      address: textOrNull(f, 'address'),
      colonia: textOrNull(f, 'colonia'),
      postal_code: textOrNull(f, 'postal_code'),
      city: textOrNull(f, 'city') ?? undefined,
      state: textOrNull(f, 'state') ?? undefined,
      lat,
      lon,
      cfe_tariff: textOrNull(f, 'cfe_tariff'),
      avg_monthly_kwh: numberOrNull(f, 'avg_monthly_kwh'),
      avg_monthly_bill_mxn: numberOrNull(f, 'avg_monthly_bill_mxn'),
      tariff_mxn_per_kwh: numberOrNull(f, 'tariff_mxn_per_kwh'),
      report_email: textOrNull(f, 'report_email'),
    };
    const bad = invalidNumbers(f, [
      'avg_monthly_kwh',
      'avg_monthly_bill_mxn',
      'tariff_mxn_per_kwh',
    ]);
    if (lat !== null && Number.isNaN(lat))
      bad.lat = 'Escribe un número (usa punto para decimales).';
    if (lon !== null && Number.isNaN(lon))
      bad.lon = 'Escribe un número (usa punto para decimales).';
    if (Object.keys(bad).length > 0) {
      setErrors(bad);
      setError('Revisa los campos marcados.');
      return;
    }
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const saved = await api(client ? `/clients/${client.id}` : '/clients', clientSchema, {
        method: client ? 'PATCH' : 'POST',
        body,
      });
      router.push(`/clients/${saved.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const v = (name: keyof Client) => {
    const value = client?.[name];
    return value === null || value === undefined ? undefined : String(value);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      <Fieldset legend="Cliente">
        <TextInput
          id="name"
          label="Nombre o razón social"
          required
          maxLength={200}
          defaultValue={v('name')}
          error={errors.name}
        />
        <TextInput
          id="contact_name"
          label="Persona de contacto"
          maxLength={200}
          defaultValue={v('contact_name')}
          error={errors.contact_name}
        />
        <TextInput
          id="phone"
          label="Teléfono"
          type="tel"
          autoComplete="off"
          defaultValue={v('phone')}
          error={errors.phone}
        />
        <TextInput
          id="email"
          label="Correo"
          type="email"
          defaultValue={v('email')}
          error={errors.email}
        />
      </Fieldset>
      <Fieldset
        legend="Ubicación"
        description="Usa un punto aproximado del domicilio. Toca el mapa para fijarlo o escribe las coordenadas."
      >
        <TextInput
          id="address"
          label="Dirección"
          required
          maxLength={300}
          defaultValue={v('address')}
          error={errors.address}
        />
        <TextInput
          id="colonia"
          label="Colonia"
          required
          maxLength={120}
          defaultValue={v('colonia')}
          error={errors.colonia}
        />
        <TextInput
          id="postal_code"
          label="Código postal"
          required
          inputMode="numeric"
          maxLength={5}
          defaultValue={v('postal_code')}
          error={errors.postal_code}
        />
        <TextInput
          id="city"
          label="Ciudad"
          placeholder="Culiacán"
          defaultValue={v('city')}
          error={errors.city}
        />
        <TextInput
          id="state"
          label="Estado"
          placeholder="Sinaloa"
          defaultValue={v('state')}
          error={errors.state}
        />
        <div className="sm:col-span-2">
          <LocationPicker
            lat={lat}
            lon={lon}
            onChange={(a, b) => {
              setLat(Number(a.toFixed(6)));
              setLon(Number(b.toFixed(6)));
            }}
          />
        </div>
        <TextInput
          id="lat"
          label="Latitud"
          required
          inputMode="decimal"
          value={lat ?? ''}
          onChange={(e) => setLat(e.target.value === '' ? null : Number(e.target.value))}
          error={errors.lat}
        />
        <TextInput
          id="lon"
          label="Longitud"
          required
          inputMode="decimal"
          value={lon ?? ''}
          onChange={(e) => setLon(e.target.value === '' ? null : Number(e.target.value))}
          error={errors.lon}
        />
      </Fieldset>
      <Fieldset
        legend="Consumo y reportes"
        description="Opcional: sirve para estimar ahorros en el reporte mensual."
      >
        <TextInput
          id="cfe_tariff"
          label="Tarifa CFE"
          placeholder="1F, DAC, PDBT…"
          defaultValue={v('cfe_tariff')}
          error={errors.cfe_tariff}
        />
        <TextInput
          id="tariff_mxn_per_kwh"
          label="Precio por kWh (MXN)"
          inputMode="decimal"
          defaultValue={v('tariff_mxn_per_kwh')}
          error={errors.tariff_mxn_per_kwh}
        />
        <TextInput
          id="avg_monthly_kwh"
          label="Consumo mensual promedio (kWh)"
          inputMode="decimal"
          defaultValue={v('avg_monthly_kwh')}
          error={errors.avg_monthly_kwh}
        />
        <TextInput
          id="avg_monthly_bill_mxn"
          label="Recibo mensual promedio (MXN)"
          inputMode="decimal"
          defaultValue={v('avg_monthly_bill_mxn')}
          error={errors.avg_monthly_bill_mxn}
        />
        <TextInput
          id="report_email"
          label="Correo para reportes"
          type="email"
          defaultValue={v('report_email')}
          error={errors.report_email}
        />
      </Fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : client ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

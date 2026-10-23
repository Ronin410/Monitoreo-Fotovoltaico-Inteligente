import Link from 'next/link';
import { StatusBadge } from '@/components/status';
import { formatEnergy, formatNumber, formatPct } from '@/lib/format';
import { BRAND_LABELS, type Plant } from '@/lib/inventory';

// Lista de plantas: tabla en pantallas anchas y tarjetas en el celular (specs/09).

function cleaning(days: number | null) {
  if (days === null) return '—';
  return days === 0 ? 'Ya' : `${days} ${days === 1 ? 'día' : 'días'}`;
}

function energy(kwh: number | undefined) {
  if (kwh === undefined) return '—';
  const e = formatEnergy(kwh);
  return `${e.value} ${e.unit}`;
}

export function PlantTable({
  plants,
  showClient = true,
}: {
  plants: Plant[];
  showClient?: boolean;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Planta
              </th>
              {showClient && (
                <th scope="col" className="px-4 py-3 font-semibold">
                  Cliente
                </th>
              )}
              <th scope="col" className="px-4 py-3 font-semibold">
                Colonia
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                kWp
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Potencia
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Hoy
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                PR 7 días
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Estado
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Lavado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {plants.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td className="px-4 py-3">
                  <Link
                    href={`/plants/${p.id}`}
                    className="font-medium text-brand-text hover:underline"
                  >
                    {p.name}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {BRAND_LABELS[p.inverter_brand]}
                  </div>
                </td>
                {showClient && <td className="px-4 py-3">{p.client.name}</td>}
                <td className="px-4 py-3">{p.colonia}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {formatNumber(p.capacity_kwp, 1)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {p.last_power_kw === null ? '—' : `${formatNumber(p.last_power_kw, 1)} kW`}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {energy(p.metrics?.energy_today_kwh)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {p.metrics?.pr_temp_7d == null ? '—' : formatPct(p.metrics.pr_temp_7d)}
                </td>
                <td className="px-4 py-3">
                  {p.metrics && <StatusBadge status={p.metrics.status} />}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {cleaning(p.metrics?.days_to_cleaning ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden">
        {plants.map((p) => (
          <li key={p.id}>
            <Link
              href={`/plants/${p.id}`}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                {p.metrics && <StatusBadge status={p.metrics.status} />}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {showClient && `${p.client.name} · `}
                {p.colonia} · {formatNumber(p.capacity_kwp, 1)} kWp
              </span>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Hoy</dt>
                  <dd className="tabular-nums">{energy(p.metrics?.energy_today_kwh)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">PR 7 días</dt>
                  <dd className="tabular-nums">
                    {p.metrics?.pr_temp_7d == null ? '—' : formatPct(p.metrics.pr_temp_7d)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Lavado</dt>
                  <dd className="tabular-nums">{cleaning(p.metrics?.days_to_cleaning ?? null)}</dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

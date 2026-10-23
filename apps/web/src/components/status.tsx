import {
  AlertTriangle,
  CircleCheck,
  CircleHelp,
  OctagonAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { PlantStatus } from '@/lib/dashboard';

// Colores de estado de specs/09, siempre con ícono y texto (no solo color). Los marcadores del
// mapa también cambian de forma.

export const STATUS: Record<
  PlantStatus,
  {
    label: string;
    icon: LucideIcon;
    badge: string;
    marker: string;
    shape: 'circle' | 'diamond' | 'ring' | 'square';
  }
> = {
  ok: {
    label: 'Bien',
    icon: CircleCheck,
    badge: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    marker: '#15803D',
    shape: 'circle',
  },
  warning: {
    label: 'Advertencia',
    icon: AlertTriangle,
    badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
    marker: '#D97706',
    shape: 'diamond',
  },
  critical: {
    label: 'Crítica',
    icon: OctagonAlert,
    badge: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    marker: '#DC2626',
    shape: 'square',
  },
  offline: {
    label: 'Sin datos',
    icon: WifiOff,
    badge: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
    marker: '#4B5563',
    shape: 'ring',
  },
  no_data: {
    label: 'Sin métricas',
    icon: CircleHelp,
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    marker: '#9CA3AF',
    shape: 'ring',
  },
};

export function StatusBadge({ status }: { status: PlantStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.badge}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {s.label}
    </span>
  );
}

/** Severidad de alerta con el mismo lenguaje visual. */
export function SeverityBadge({ severity }: { severity: 'info' | 'warning' | 'critical' }) {
  if (severity === 'info') {
    return (
      <span className="inline-flex items-center rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-300">
        Aviso
      </span>
    );
  }
  return <StatusBadge status={severity} />;
}

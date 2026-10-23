'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Notice, Spinner } from '@/components/ui';
import { useCompanyTimezone } from '@/lib/auth';
import { companySchema, type Company } from '@/lib/settings';
import { useApiQuery } from '@/lib/use-api';
import { AiUsagePanel } from './ai-usage-panel';
import { CompanyForm } from './company-form';
import { NotificationsSection, NumbersSection } from './settings-section';
import { UsersPanel } from './users-panel';

// Configuración de la empresa (specs/09 §Configuración, solo company_admin).

const TABS = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'tecnicos', label: 'Valores técnicos' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'ia', label: 'Uso de IA' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function SettingsView() {
  const timezone = useCompanyTimezone();
  const query = useApiQuery('/company', companySchema);
  const [saved, setSaved] = useState<Company | null>(null);
  const [tab, setTab] = useState<Tab>('empresa');
  const company = saved ?? query.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Configuración" subtitle={company?.name} />
      <div role="tablist" aria-label="Secciones" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm whitespace-nowrap ${tab === t.id ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {query.error ? (
          <Notice tone="error">{query.error.message}</Notice>
        ) : !company ? (
          <Spinner />
        ) : tab === 'empresa' ? (
          <CompanyForm company={company} onSaved={setSaved} />
        ) : tab === 'alertas' ? (
          <NumbersSection section="thresholds" company={company} onSaved={setSaved} />
        ) : tab === 'tecnicos' ? (
          <NumbersSection section="defaults" company={company} onSaved={setSaved} />
        ) : tab === 'notificaciones' ? (
          <NotificationsSection company={company} onSaved={setSaved} />
        ) : tab === 'usuarios' ? (
          <UsersPanel timezone={timezone} />
        ) : (
          <AiUsagePanel />
        )}
      </div>
    </div>
  );
}

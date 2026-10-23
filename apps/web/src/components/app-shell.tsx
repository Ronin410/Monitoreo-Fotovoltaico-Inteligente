'use client';

import {
  Activity,
  Bell,
  Bot,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings,
  SolarPanel,
  Sun,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { brandColor, brandText, onBrand } from '@/lib/brand';
import { navItems, ROLE_LABELS, type NavIcon } from '@/lib/nav';
import type { Me } from '@/lib/schemas';
import { useTheme, type ThemeChoice } from '@/lib/theme';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  plants: SolarPanel,
  clients: Users,
  alerts: Bell,
  tickets: Wrench,
  assistant: Bot,
  reports: FileText,
  settings: Settings,
  companies: Building2,
  health: Activity,
};

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function Brand({ company }: { company: Me['company'] }) {
  const name = company?.name ?? 'PV-IoT';
  return (
    <div className="flex min-w-0 items-center gap-3">
      {company?.logo_url ? (
        // Logo subido por la empresa (servido por la API vía /api); tamaño fijo.
        <img src={company.logo_url} alt="" className="size-9 rounded-md object-contain" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-bold text-on-brand"
        >
          {initials(name)}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">Monitoreo con PV-IoT</span>
      </span>
    </div>
  );
}

function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  return (
    <fieldset className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
      <legend className="sr-only">Tema</legend>
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          aria-label={`Tema ${label.toLowerCase()}`}
          title={label}
          onClick={() => setChoice(value)}
          className={`flex min-h-9 flex-1 items-center justify-center rounded-md ${
            choice === value
              ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </fieldset>
  );
}

export function AppShell({
  user,
  company,
  children,
}: {
  user: Me['user'];
  company: Me['company'];
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const brand = brandColor(company?.brand_color);
  const items = navItems(user.role);

  // Al navegar en el celular se cierra el menú.
  useEffect(() => setOpen(false), [pathname]);

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
              active
                ? 'bg-brand/10 font-semibold text-brand-text dark:bg-brand/20'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
        >
          {initials(user.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
      </div>
      <ThemeSwitch />
      <button
        type="button"
        onClick={() => void logout()}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <LogOut aria-hidden="true" className="size-5" />
        Cerrar sesión
      </button>
    </div>
  );

  return (
    <div
      data-brand=""
      style={
        {
          '--brand': brand,
          '--on-brand': onBrand(brand),
          // Fondos: blanco y slate-900 (tarjetas y barra lateral).
          '--brand-text-light': brandText(brand, '#FFFFFF'),
          '--brand-text-dark': brandText(brand, '#0F172A'),
        } as CSSProperties
      }
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-slate-900"
      >
        Saltar al contenido
      </a>

      {/* Celular: barra superior con menú desplegable. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <Brand company={company} />
        <button
          type="button"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="menu-movil"
          onClick={() => setOpen((v) => !v)}
          className="flex size-11 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {open ? (
            <X aria-hidden="true" className="size-6" />
          ) : (
            <Menu aria-hidden="true" className="size-6" />
          )}
        </button>
      </header>
      {open && (
        <div
          id="menu-movil"
          className="fixed inset-x-0 top-[57px] bottom-0 z-20 flex flex-col justify-between gap-4 overflow-y-auto bg-white p-4 lg:hidden dark:bg-slate-900"
        >
          {nav}
          {footer}
        </div>
      )}

      <div className="lg:flex">
        {/* Escritorio: barra lateral fija. */}
        <aside className="hidden w-64 shrink-0 flex-col justify-between gap-6 border-r border-slate-200 bg-white p-4 lg:sticky lg:top-0 lg:flex lg:h-screen dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-6">
            <Brand company={company} />
            {nav}
          </div>
          {footer}
        </aside>
        <main id="contenido" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

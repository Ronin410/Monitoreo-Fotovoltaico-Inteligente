'use client';

import { LogIn, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SITE_NAV } from './content';
import { Logo } from './logo';

/** Menú del sitio público: pestañas en escritorio y menú desplegable en celular. */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const linkClass = (href: string) => {
    const active = pathname === href;
    return active
      ? 'text-white after:absolute after:inset-x-0 after:-bottom-[21px] after:h-0.5 after:bg-amber-400'
      : 'text-slate-300 hover:text-white';
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#071a24]/95 text-white backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/inicio" aria-label="PV-IoT, inicio">
          <Logo />
        </Link>
        <nav aria-label="Secciones del sitio" className="hidden items-center gap-7 text-sm md:flex">
          {SITE_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname === n.href ? 'page' : undefined}
              className={`relative ${linkClass(n.href)}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden min-h-10 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-medium hover:bg-white/10 sm:inline-flex"
          >
            <LogIn aria-hidden="true" className="size-4" /> Iniciar sesión
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10 md:hidden"
            aria-expanded={open}
            aria-controls="menu-sitio"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="menu-sitio"
          aria-label="Secciones del sitio"
          className="border-t border-white/10 px-4 pb-4 md:hidden"
        >
          <ul className="flex flex-col">
            {SITE_NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={pathname === n.href ? 'page' : undefined}
                  className={`flex min-h-12 items-center border-b border-white/5 text-base ${
                    pathname === n.href ? 'font-semibold text-amber-300' : 'text-slate-200'
                  }`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/login"
                className="flex min-h-12 items-center gap-2 text-base text-slate-200"
              >
                <LogIn aria-hidden="true" className="size-4" /> Iniciar sesión
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

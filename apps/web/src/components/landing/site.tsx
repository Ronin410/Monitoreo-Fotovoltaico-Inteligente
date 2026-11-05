import { ArrowRight, Mail, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LegalLinks } from '@/components/legal-page';
import { CONTACT_LINKS, type ContactLink } from '@/lib/contact';
import { NAME_MEANING, SITE_NAV } from './content';
import { Logo } from './logo';

// Piezas compartidas del sitio público: encabezado de página, botones de contacto, banda de
// llamada a la acción y pie.

/** Botón principal (ámbar, el color del sol) y secundario. */
export const primaryButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-amber-400 px-6 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-amber-300 focus-visible:outline-amber-300';
export const ghostButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/25 px-6 text-sm font-semibold text-white transition hover:bg-white/10';

/** Fondo oscuro de la marca, con un brillo cálido arriba. */
export const darkBand =
  'relative overflow-hidden bg-[#071a24] text-white before:pointer-events-none before:absolute before:-top-40 before:left-1/2 before:size-[640px] before:-translate-x-1/2 before:rounded-full before:bg-cyan-500/15 before:blur-3xl';

export function ContactButtons({
  links,
  align = 'start',
}: {
  links: ContactLink[];
  align?: 'start' | 'center';
}) {
  if (links.length === 0) {
    return (
      <div className={`flex flex-col gap-3 ${align === 'center' ? 'items-center' : ''}`}>
        <Link href="/inicio/funciones" className={primaryButton}>
          Ver funciones <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <p className="text-sm text-slate-300">Los datos de contacto se publicarán pronto.</p>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap gap-3 ${align === 'center' ? 'justify-center' : ''}`}>
      {links.map((l) =>
        l.kind === 'email' ? (
          <a key={l.href} href={l.href} className={primaryButton}>
            <Mail aria-hidden="true" className="size-4" /> Solicitar una demostración
          </a>
        ) : (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={ghostButton}>
            <MessageCircle aria-hidden="true" className="size-4" /> Escribir por WhatsApp
          </a>
        ),
      )}
    </div>
  );
}

/** Encabezado de las páginas internas del sitio. */
export function PageIntro({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <section className={darkBand}>
      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-14 sm:pt-20">
        <p className="text-sm font-semibold tracking-wide text-amber-300 uppercase">{eyebrow}</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-slate-300">{text}</p>
      </div>
    </section>
  );
}

export function Container({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto max-w-6xl px-4 ${className}`}>{children}</div>;
}

/** Banda final de contacto, igual en todas las páginas. */
export function CtaBand({ contact = CONTACT_LINKS }: { contact?: ContactLink[] }) {
  return (
    <section aria-labelledby="cta-title" className="px-4 py-16 sm:py-20">
      <div className={`${darkBand} mx-auto max-w-6xl rounded-3xl px-6 py-12 text-center sm:px-12`}>
        <div className="relative">
          <h2 id="cta-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            ¿Quiere verlo con sus propias plantas?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Le mostramos la plataforma con datos de ejemplo y platicamos un piloto con algunas de
            las plantas que ya administra.
          </p>
          <div className="mt-8">
            <ContactButtons links={contact} align="center" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-10 text-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo tagline />
          <p className="mt-3 max-w-sm text-slate-600 dark:text-slate-400">{NAME_MEANING}</p>
        </div>
        <nav aria-label="Pie de página">
          <ul className="flex flex-col gap-2">
            {SITE_NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-2">
          <Link
            href="/login"
            className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
          >
            Iniciar sesión
          </Link>
          <LegalLinks className="flex-col" />
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-xs text-slate-500 dark:text-slate-400">
        Los nombres de marcas de inversores pertenecen a sus respectivos dueños; PV-IoT no está
        afiliada a ellas.
      </p>
    </footer>
  );
}

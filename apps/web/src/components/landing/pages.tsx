import {
  ArrowRight,
  BatteryCharging,
  Bot,
  Check,
  Clock,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  MapPinned,
  PlugZap,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { CONTACT_LINKS, type ContactLink } from '@/lib/contact';
import {
  BRAND_STATUS,
  BRANDS,
  FAQ,
  HIGHLIGHTS,
  NAME_MEANING,
  PILLARS,
  SECURITY,
  STEPS,
  TOOLS,
} from './content';
import { PillarIllustration } from './illustrations';
import { Container, ContactButtons, CtaBand, darkBand, ghostButton, PageIntro } from './site';

// Páginas del sitio público (/inicio y sus secciones). El contenido vive en content.ts.

type Props = { contact?: ContactLink[] };

export function HomePage({ contact = CONTACT_LINKS }: Props) {
  const [first] = PILLARS;
  return (
    <>
      <section className={darkBand}>
        <Container className="relative grid items-center gap-12 pt-16 pb-20 sm:pt-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
              <span className="size-1.5 rounded-full bg-amber-400" aria-hidden="true" />
              Para empresas instaladoras de sistemas solares
            </p>
            <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
              Cada planta solar de sus clientes,{' '}
              <span className="text-amber-300">rindiendo lo que debe.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-300">
              PV-IoT vigila la producción de todas sus plantas, le dice cuándo conviene lavarlas y
              le avisa de fallas antes de que su cliente lo note.
            </p>
            <div className="mt-9">
              <ContactButtons links={contact} />
            </div>
            <p className="mt-6 text-sm text-slate-400">
              Sin instalar equipos nuevos · Varias marcas de inversor · Desde el celular
            </p>
          </div>
          {first && <PillarIllustration art={first.art} />}
        </Container>
      </section>

      <section aria-labelledby="ideas-title" className="bg-white py-20 dark:bg-slate-950">
        <Container>
          <h2 id="ideas-title" className="sr-only">
            Qué hace PV-IoT
          </h2>
          <ol className="grid gap-10 md:grid-cols-3">
            {HIGHLIGHTS.map((h, i) => (
              <li key={h.title}>
                <span className="text-sm font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">{h.title}</h3>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{h.text}</p>
              </li>
            ))}
          </ol>
          <Link
            href="/inicio/funciones"
            className="mt-12 inline-flex items-center gap-2 font-semibold text-cyan-800 hover:gap-3 dark:text-cyan-300"
          >
            Conocer todas las funciones <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Container>
      </section>

      <section className="bg-slate-50 py-16 dark:bg-slate-900/40">
        <Container className="max-w-3xl text-center">
          <p className="text-2xl leading-snug font-medium tracking-tight text-slate-800 sm:text-3xl dark:text-slate-100">
            “Un portal de fabricante le dice cuánto produjo una planta. PV-IoT le dice si eso es lo
            que debería haber producido, y qué hacer si no.”
          </p>
          <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
            ¿Y el nombre? {NAME_MEANING}
          </p>
        </Container>
      </section>

      <CtaBand contact={contact} />
    </>
  );
}

export function FeaturesPage({ contact = CONTACT_LINKS }: Props) {
  const toolIcons: LucideIcon[] = [
    MapPinned,
    Bot,
    FileSpreadsheet,
    Clock,
    BatteryCharging,
    Download,
  ];
  return (
    <>
      <PageIntro
        eyebrow="Funciones"
        title="Todo para cuidar cientos de plantas sin visitarlas una por una"
        text="Cuatro funciones principales hacen el trabajo pesado; el resto de las herramientas las acompañan en el día a día."
      />
      <div className="bg-white dark:bg-slate-950">
        {PILLARS.map((p, i) => (
          <section
            key={p.id}
            id={p.id}
            aria-labelledby={`${p.id}-title`}
            className="scroll-mt-20 border-b border-slate-100 py-16 last:border-0 sm:py-24 dark:border-slate-900"
          >
            <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                <p className="text-sm font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                  {p.eyebrow}
                </p>
                <h2
                  id={`${p.id}-title`}
                  className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl"
                >
                  {p.title}
                </h2>
                <p className="mt-4 text-slate-600 dark:text-slate-400">{p.text}</p>
                <ul className="mt-6 flex flex-col gap-2.5">
                  {p.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-cyan-700 dark:text-cyan-400"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? 'lg:order-1' : ''}>
                <PillarIllustration art={p.art} />
              </div>
            </Container>
          </section>
        ))}
      </div>
      <section
        aria-labelledby="herramientas-title"
        className="bg-slate-50 py-16 sm:py-20 dark:bg-slate-900/40"
      >
        <Container>
          <h2 id="herramientas-title" className="text-2xl font-semibold tracking-tight">
            Y además
          </h2>
          <ul className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t, i) => {
              const Icon = toolIcons[i] ?? Check;
              return (
                <li key={t.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cyan-700/10 text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-300">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span>
                    <span className="block font-semibold">{t.title}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">{t.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Container>
      </section>
      <CtaBand contact={contact} />
    </>
  );
}

export function HowItWorksPage({ contact = CONTACT_LINKS }: Props) {
  return (
    <>
      <PageIntro
        eyebrow="Cómo funciona"
        title="En marcha en tres pasos"
        text="Usa los datos que sus inversores ya envían al portal de su fabricante. No hay que instalar nada en las plantas."
      />
      <section aria-labelledby="pasos-title" className="bg-white py-16 sm:py-24 dark:bg-slate-950">
        <Container>
          <h2 id="pasos-title" className="sr-only">
            Pasos
          </h2>
          <ol className="relative grid gap-12 md:grid-cols-3 md:gap-8">
            <span
              aria-hidden="true"
              className="absolute top-6 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-amber-300 via-cyan-600 to-amber-300 md:block"
            />
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative text-center md:px-4">
                <span className="relative mx-auto flex size-12 items-center justify-center rounded-full bg-[#071a24] text-lg font-semibold text-amber-300 ring-8 ring-white dark:ring-slate-950">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
      <section
        aria-labelledby="marcas-title"
        className="bg-slate-50 py-16 sm:py-20 dark:bg-slate-900/40"
      >
        <Container>
          <h2 id="marcas-title" className="text-2xl font-semibold tracking-tight">
            Marcas de inversor
          </h2>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Las plantas de cualquier marca se registran desde el primer día; sus datos se leen según
            el estado de su integración.
          </p>
          <ul className="mt-8 flex flex-wrap gap-3">
            {BRANDS.map((b) => (
              <li
                key={b.name}
                className="flex items-center gap-3 rounded-full border border-slate-200 bg-white py-2 pr-2 pl-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <PlugZap aria-hidden="true" className="size-4 text-slate-400" />
                <span className="font-medium">{b.name}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    b.status === 'ready'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : b.status === 'integrating'
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {BRAND_STATUS[b.status]}
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>
      <CtaBand contact={contact} />
    </>
  );
}

export function SecurityPage({ contact = CONTACT_LINKS }: Props) {
  const icons: LucideIcon[] = [ShieldCheck, KeyRound, Lock, Download];
  return (
    <>
      <PageIntro
        eyebrow="Seguridad y privacidad"
        title="Sus datos y los de sus clientes, protegidos"
        text="Usted es responsable de los datos de sus clientes; nosotros los tratamos solo para darle el servicio."
      />
      <section
        aria-labelledby="seguridad-title"
        className="bg-white py-16 sm:py-24 dark:bg-slate-950"
      >
        <Container>
          <h2 id="seguridad-title" className="sr-only">
            Medidas de seguridad
          </h2>
          <ul className="grid gap-x-12 gap-y-12 md:grid-cols-2">
            {SECURITY.map((s, i) => {
              const Icon = icons[i] ?? ShieldCheck;
              return (
                <li key={s.title} className="flex gap-5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#071a24] text-amber-300">
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <span>
                    <span className="block text-lg font-semibold">{s.title}</span>
                    <span className="mt-1 block text-slate-600 dark:text-slate-400">{s.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-14 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
            Más detalles en el{' '}
            <Link
              href="/privacidad"
              className="font-medium text-cyan-800 underline dark:text-cyan-300"
            >
              aviso de privacidad
            </Link>{' '}
            y los{' '}
            <Link
              href="/terminos"
              className="font-medium text-cyan-800 underline dark:text-cyan-300"
            >
              términos de uso
            </Link>
            .
          </p>
        </Container>
      </section>
      <CtaBand contact={contact} />
    </>
  );
}

export function ContactPage({ contact = CONTACT_LINKS }: Props) {
  return (
    <>
      <section className={darkBand}>
        <Container className="relative pt-16 pb-16 text-center sm:pt-24">
          <p className="text-sm font-semibold tracking-wide text-amber-300 uppercase">Contacto</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
            Platiquemos de sus plantas
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-300">
            Le mostramos la plataforma con datos de ejemplo y vemos juntos un piloto con algunas de
            las plantas que ya administra.
          </p>
          <div className="mt-9">
            <ContactButtons links={contact} align="center" />
          </div>
          {contact.length > 0 && (
            <p className="mt-6 text-sm text-slate-400">{contact.map((c) => c.label).join(' · ')}</p>
          )}
        </Container>
      </section>
      <section
        aria-labelledby="preguntas-title"
        className="bg-white py-16 sm:py-24 dark:bg-slate-950"
      >
        <Container className="max-w-3xl">
          <h2 id="preguntas-title" className="text-2xl font-semibold tracking-tight">
            Preguntas frecuentes
          </h2>
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-base font-medium">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition group-open:rotate-45 dark:border-slate-700"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-4 text-slate-600 dark:text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
          <Link
            href="/inicio/como-funciona"
            className={`${ghostButton} mt-10 border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-900`}
          >
            Ver cómo funciona <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Container>
      </section>
    </>
  );
}

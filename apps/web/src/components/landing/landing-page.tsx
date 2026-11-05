import {
  ArrowRight,
  BellRing,
  Bot,
  ChartLine,
  Check,
  CloudSun,
  Download,
  Droplets,
  FileSpreadsheet,
  FileText,
  Lock,
  LogIn,
  Mail,
  MapPinned,
  MessageCircle,
  Palette,
  PlugZap,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LegalLinks } from '@/components/legal-page';
import { CONTACT_LINKS, type ContactLink } from '@/lib/contact';

// Página pública para interesados (docs/plan-lanzamiento.md 6.7). Reglas del contenido:
// - Solo funciones que existen hoy en la plataforma; lo que viene se dice como "próximamente".
// - Sin precios, sin testimonios ni cifras inventadas, y sin certificaciones que no se tengan.
// - La vista previa del tablero lleva la etiqueta "datos de ejemplo".

const NAV = [
  { href: '#beneficios', label: 'Beneficios' },
  { href: '#funciones', label: 'Funciones' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#marcas', label: 'Marcas' },
  { href: '#seguridad', label: 'Seguridad' },
  { href: '#preguntas', label: 'Preguntas' },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Droplets,
    title: 'Lavado en el momento justo',
    text: 'Medimos cómo baja el rendimiento de cada planta día con día y le decimos cuántos días faltan para que convenga lavarla. Si llueve lo suficiente, lo tomamos como un lavado.',
  },
  {
    icon: BellRing,
    title: 'Fallas antes de que llame su cliente',
    text: 'Alertas por caída brusca de producción, por suciedad y por planta sin datos. Cada alerta trae la evidencia de los últimos días y una explicación en palabras simples.',
  },
  {
    icon: CloudSun,
    title: 'Sin falsas alarmas por el clima',
    text: 'Comparamos la producción real con la esperada según el sol y la temperatura de ese día. Si todas las plantas de una zona bajan a la vez (nublado, polvo), no se culpa a ninguna.',
  },
  {
    icon: FileText,
    title: 'Reportes que sus clientes entienden',
    text: 'Un PDF mensual por cliente, con el logo y el color de su empresa: energía generada, ahorro estimado y estado de sus paneles.',
  },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: MapPinned,
    title: 'Tablero y mapa',
    text: 'Todas las plantas de todos sus clientes en una pantalla, con su estado del día y su ubicación.',
  },
  {
    icon: ChartLine,
    title: 'Rendimiento real (PR)',
    text: 'Energía, rendimiento corregido por temperatura y comparación con plantas vecinas.',
  },
  {
    icon: Bot,
    title: 'Asistente con IA',
    text: 'Pregunte "¿qué plantas rinden menos este mes?" y obtenga la respuesta con los datos de su empresa.',
  },
  {
    icon: Wrench,
    title: 'Tickets para técnicos',
    text: 'De la alerta al ticket en un clic. Sus técnicos lo atienden desde el celular y usted ve cuánto tardan.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Alta masiva desde Excel',
    text: 'Suba cientos de clientes y plantas con una plantilla; el sistema le marca cada error antes de guardar.',
  },
  {
    icon: Palette,
    title: 'Con la marca de su empresa',
    text: 'Su logo y su color en la plataforma y en los reportes que reciben sus clientes.',
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Dé de alta sus clientes y plantas',
    text: 'Uno por uno o todos a la vez desde Excel: capacidad, ubicación y marca del inversor.',
  },
  {
    title: 'Conecte los inversores',
    text: 'Con las llaves de acceso del portal de cada fabricante. Se guardan cifradas y no se vuelven a mostrar.',
  },
  {
    title: 'La plataforma trabaja sola',
    text: 'Lee la producción cada 15 minutos, descarga el clima, calcula el rendimiento cada noche y le avisa cuando algo requiere atención.',
  },
];

const BRANDS: { name: string; status: 'ready' | 'integrating' | 'soon' }[] = [
  { name: 'Victron Energy (VRM)', status: 'ready' },
  { name: 'GoodWe (SEMS)', status: 'integrating' },
  { name: 'Growatt', status: 'soon' },
  { name: 'Huawei', status: 'soon' },
  { name: 'Fronius', status: 'soon' },
  { name: 'Enphase', status: 'soon' },
];
const BRAND_STATUS = {
  ready: 'Disponible',
  integrating: 'En integración',
  soon: 'Próximamente',
} as const;

const SECURITY: string[] = [
  'Cada empresa solo ve sus propios datos: el aislamiento se aplica en la aplicación y en la base de datos.',
  'Las credenciales de los inversores se guardan cifradas y nunca se muestran ni se devuelven.',
  'La inteligencia artificial no recibe teléfonos, correos, domicilios ni credenciales de sus clientes.',
  'Usted puede exportar todos los datos de su empresa cuando quiera, en archivos que se abren en Excel.',
  'Al terminar el servicio, sus datos se pueden borrar de forma definitiva, incluidos sus archivos.',
];

const FAQ: { q: string; a: string }[] = [
  {
    q: '¿Tengo que cambiar los inversores o instalar algún equipo?',
    a: 'No. La plataforma lee los datos que el inversor ya envía al portal de su fabricante, con las llaves de acceso de ese portal.',
  },
  {
    q: '¿Qué pasa con las plantas de marcas que todavía no se conectan?',
    a: 'Se registran igual y aparecen en el mapa, el inventario y los tickets. Sus datos se leerán en cuanto esté lista la integración con su marca.',
  },
  {
    q: '¿Mis clientes entran a la plataforma?',
    a: 'Hoy la usan su empresa y sus técnicos. Sus clientes reciben el reporte mensual en PDF por correo, con su marca.',
  },
  {
    q: '¿Sirve para plantas con batería?',
    a: 'Sí. Puede marcarlas como plantas con batería o con límite de inyección a la red, para que una producción limitada a propósito no se confunda con suciedad o con una falla.',
  },
  {
    q: '¿Se puede usar desde el celular?',
    a: 'Sí. Todas las pantallas se adaptan al celular, pensadas para el técnico en campo.',
  },
  {
    q: '¿Cómo empiezo?',
    a: 'Escríbanos para agendar una demostración con datos de ejemplo y platicar un piloto con algunas de sus plantas.',
  },
];

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        {intro && (
          <p className="mt-3 max-w-3xl text-base text-slate-600 dark:text-slate-400">{intro}</p>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function ContactButtons({
  links,
  align = 'start',
}: {
  links: ContactLink[];
  align?: 'start' | 'center';
}) {
  return (
    <div className={`flex flex-wrap gap-3 ${align === 'center' ? 'justify-center' : ''}`}>
      {links.map((l) => {
        const Icon = l.kind === 'email' ? Mail : MessageCircle;
        return (
          <a
            key={l.href}
            href={l.href}
            target={l.kind === 'whatsapp' ? '_blank' : undefined}
            rel={l.kind === 'whatsapp' ? 'noreferrer' : undefined}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-on-brand hover:opacity-90"
          >
            <Icon aria-hidden="true" className="size-4" />
            {l.kind === 'email' ? 'Solicitar una demostración' : 'Escribir por WhatsApp'}
          </a>
        );
      })}
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <LogIn aria-hidden="true" className="size-4" /> Ya tengo cuenta
      </Link>
    </div>
  );
}

/** Vista previa ilustrativa del tablero (no son datos reales). */
function DashboardPreview() {
  const kpis = [
    { label: 'Plantas activas', value: '25' },
    { label: 'Energía hoy', value: '1.2 MWh' },
    { label: 'Rendimiento (PR)', value: '84 %' },
  ];
  const alerts = [
    { tone: 'bg-amber-500', title: 'Suciedad', where: 'Casa Pérez · lavar en 4 días' },
    { tone: 'bg-red-600', title: 'Caída brusca', where: 'Bodega Norte · −38 % desde ayer' },
    { tone: 'bg-sky-600', title: 'Limpieza próxima', where: 'Abarrotes El Sol · en 6 días' },
  ];
  return (
    <figure
      aria-label="Vista previa del tablero con datos de ejemplo"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Tablero</span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          Datos de ejemplo
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <dt className="text-[11px] leading-tight text-slate-600 dark:text-slate-400">
              {k.label}
            </dt>
            <dd className="mt-1 text-base font-semibold tabular-nums sm:text-lg">{k.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 flex flex-col gap-2">
        {alerts.map((a) => (
          <li
            key={a.title}
            className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
          >
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${a.tone}`} />
            <span className="min-w-0 text-sm">
              <span className="font-medium">{a.title}</span>
              <span className="block truncate text-xs text-slate-600 dark:text-slate-400">
                {a.where}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Ilustración: los nombres y valores no son de clientes reales.
      </figcaption>
    </figure>
  );
}

export function LandingPage({ contact = CONTACT_LINKS }: { contact?: ContactLink[] }) {
  return (
    <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 dark:focus:bg-slate-900"
      >
        Ir al contenido
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/inicio" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/icon.svg" alt="" className="size-7" />
            PV-IoT
          </Link>
          <nav aria-label="Secciones" className="hidden gap-5 text-sm lg:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            <LogIn aria-hidden="true" className="size-4" /> Iniciar sesión
          </Link>
        </div>
      </header>

      <main id="contenido">
        <section className="bg-gradient-to-b from-cyan-50 to-white px-4 pt-14 pb-16 sm:pt-20 dark:from-cyan-950/40 dark:to-slate-950">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="text-sm font-semibold text-cyan-800 dark:text-cyan-300">
                Para empresas instaladoras de sistemas solares
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
                Monitoreo fotovoltaico inteligente para todas las plantas de sus clientes
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-700 dark:text-slate-300">
                Vea en un solo lugar cómo produce cada planta, sepa cuándo conviene lavarla y
                detecte fallas antes de que su cliente lo note.
              </p>
              <div className="mt-8">
                <ContactButtons links={contact} />
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700 dark:text-slate-300">
                {[
                  'Sin instalar equipos nuevos',
                  'Varias marcas de inversor',
                  'Desde el celular',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check aria-hidden="true" className="size-4 text-cyan-700 dark:text-cyan-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <Section
          id="beneficios"
          title="Menos visitas en vano, más plantas produciendo bien"
          intro="Un portal de fabricante le dice cuánto produjo una planta. PV-IoT le dice si eso es lo que debería haber producido, y qué hacer si no."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-xl border border-slate-200 p-6 dark:border-slate-800"
              >
                <Icon aria-hidden="true" className="size-7 text-cyan-700 dark:text-cyan-400" />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-slate-600 dark:text-slate-400">{text}</p>
              </article>
            ))}
          </div>
        </Section>

        <div className="bg-slate-50 dark:bg-slate-900/50">
          <Section id="funciones" title="Todo lo que su equipo necesita">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <article
                  key={title}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Icon aria-hidden="true" className="size-6 text-cyan-700 dark:text-cyan-400" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{text}</p>
                </article>
              ))}
            </div>
          </Section>
        </div>

        <Section id="como-funciona" title="Cómo funciona">
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="rounded-xl border border-slate-200 p-6 dark:border-slate-800"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <div className="bg-slate-50 dark:bg-slate-900/50">
          <Section
            id="marcas"
            title="Marcas de inversor"
            intro="La plataforma se conecta al portal de cada fabricante. Estas son las marcas y su estado hoy:"
          >
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BRANDS.map((b) => (
                <li
                  key={b.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <PlugZap aria-hidden="true" className="size-4 text-slate-500" />
                    {b.name}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      b.status === 'ready'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : b.status === 'integrating'
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {BRAND_STATUS[b.status]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              Los nombres de las marcas pertenecen a sus respectivos dueños; PV-IoT no está afiliada
              a ellas.
            </p>
          </Section>
        </div>

        <Section
          id="seguridad"
          title="Sus datos y los de sus clientes, protegidos"
          intro="Usted es responsable de los datos de sus clientes; nosotros los tratamos solo para darle el servicio."
        >
          <ul className="grid gap-4 md:grid-cols-2">
            {SECURITY.map((s, i) => {
              const Icon = [ShieldCheck, Lock, Bot, Download, ShieldCheck][i] ?? ShieldCheck;
              return (
                <li key={s} className="flex gap-3">
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-cyan-700 dark:text-cyan-400"
                  />
                  <span className="text-slate-700 dark:text-slate-300">{s}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-sm">
            Más detalles en el{' '}
            <Link href="/privacidad" className="text-brand-text underline">
              aviso de privacidad
            </Link>{' '}
            y los{' '}
            <Link href="/terminos" className="text-brand-text underline">
              términos de uso
            </Link>
            .
          </p>
        </Section>

        <div className="bg-slate-50 dark:bg-slate-900/50">
          <Section id="preguntas" title="Preguntas frecuentes">
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-5 py-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 transition-transform group-open:rotate-90"
                    />
                  </summary>
                  <p className="mt-2 text-slate-600 dark:text-slate-400">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>
        </div>

        <section
          id="contacto"
          aria-labelledby="contacto-title"
          className="scroll-mt-20 px-4 py-16 text-center sm:py-20"
        >
          <div className="mx-auto max-w-2xl">
            <h2 id="contacto-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              ¿Quiere verlo con sus propias plantas?
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-400">
              Le mostramos la plataforma con datos de ejemplo y platicamos un piloto con algunas de
              las plantas que ya administra.
            </p>
            <div className="mt-8">
              {contact.length > 0 ? (
                <ContactButtons links={contact} align="center" />
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Los datos de contacto se publicarán pronto.
                </p>
              )}
            </div>
            {contact.length > 0 && (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                {contact.map((c) => c.label).join(' · ')}
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 px-4 py-8 text-sm dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-600 dark:text-slate-400">
            PV-IoT · Monitoreo fotovoltaico inteligente
          </span>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}

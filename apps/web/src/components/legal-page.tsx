import Link from 'next/link';
import { LEGAL_DRAFT, type LegalDocument } from '@/content/legal';
import { formatDate } from '@/lib/format';

/** Aviso de privacidad o términos: página pública, sin sesión (specs/02 §Datos personales). */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <article className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">PV-IoT</p>
        <h1 className="mt-1 text-2xl font-semibold">{doc.title}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Versión {doc.version} · actualizado el{' '}
          {formatDate(doc.updated, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        {LEGAL_DRAFT && (
          <p
            role="note"
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            Borrador pendiente de revisión legal. Los datos entre corchetes se completarán antes de
            usar la plataforma en producción.
          </p>
        )}
        <p className="mt-6 leading-relaxed">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            {s.blocks.map((b, i) =>
              'p' in b ? (
                <p key={i} className="mt-3 leading-relaxed">
                  {b.p}
                </p>
              ) : (
                <ul key={i} className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed">
                  {b.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
        <nav className="mt-10 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
          <Link href="/" className="text-brand-text hover:underline">
            Ir a la plataforma
          </Link>
          <LegalLinks />
        </nav>
      </article>
    </main>
  );
}

/** Enlaces al aviso de privacidad y a los términos. */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-wrap gap-x-4 gap-y-1 ${className}`}>
      <Link href="/privacidad" className="text-brand-text hover:underline">
        Aviso de privacidad
      </Link>
      <Link href="/terminos" className="text-brand-text hover:underline">
        Términos de uso
      </Link>
    </span>
  );
}

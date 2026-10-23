import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <Link href="/" className="text-sm text-brand-text hover:underline">
        Ir al inicio
      </Link>
    </main>
  );
}

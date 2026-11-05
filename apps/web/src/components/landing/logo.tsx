/** Marca PV-IoT: el ícono de la plataforma (sol sobre panel) y el nombre. */
export function Logo({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0E7490" />
        <circle cx="16" cy="13" r="5" fill="#FBBF24" />
        <path d="M7 25h18l-3-6H10z" fill="#E0F2FE" />
      </svg>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight">PV-IoT</span>
        {tagline && (
          <span className="block text-xs font-normal opacity-70">
            Monitoreo fotovoltaico inteligente
          </span>
        )}
      </span>
    </span>
  );
}

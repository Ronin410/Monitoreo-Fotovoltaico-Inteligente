// Filtros de las listas: etiqueta pequeña sobre el control, en una fila que se acomoda al ancho.

export const filterControl =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900';

export function Filter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400"
    >
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={filterControl}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

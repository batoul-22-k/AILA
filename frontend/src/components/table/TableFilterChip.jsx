import { X } from "lucide-react";

export function TableFilterChip({ label, valueLabel, onClear }) {
  if (!valueLabel) return null;
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-role-border bg-role-hover px-2.5 text-xs font-black text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      <span className="text-slate-400">{label}</span>
      <span>{valueLabel}</span>
      <button
        type="button"
        className="focus-ring -mr-1 inline-grid h-5 w-5 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-role-primary dark:hover:bg-slate-950"
        onClick={onClear}
        aria-label={`Clear ${label} filter`}
      >
        <X size={12} />
      </button>
    </span>
  );
}

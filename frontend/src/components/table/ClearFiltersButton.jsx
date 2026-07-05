import { FilterX } from "lucide-react";

import { cn } from "../../utils/cn";

export function ClearFiltersButton({ active = false, onClick, children = "Clear filters", className = "" }) {
  return (
    <button
      type="button"
      className={cn(
        "focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-role-border bg-white px-3 text-xs font-black text-slate-600 transition hover:border-role-primary hover:text-role-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
        className,
      )}
      onClick={onClick}
      disabled={!active}
    >
      <FilterX size={14} />
      {children}
    </button>
  );
}

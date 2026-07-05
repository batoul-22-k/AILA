import { Search } from "lucide-react";

import { cn } from "../../utils/cn";

export function TableSearch({ value, onChange, placeholder = "Search", className = "" }) {
  return (
    <label className={cn("relative min-w-[14rem] flex-1", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input
        className="adaptive-input h-9 w-full rounded-lg border border-role-border bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
      />
    </label>
  );
}

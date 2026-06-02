import { cn } from "../utils/cn";

const tones = {
  teal: "bg-[color-mix(in_srgb,var(--role-primary)_12%,white)] text-role-primary dark:bg-brand-500/15 dark:text-brand-100",
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-100",
  green: "bg-[color-mix(in_srgb,var(--role-secondary)_20%,white)] text-[var(--role-primary-strong)] dark:bg-emerald-400/15 dark:text-emerald-100",
  red: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-100",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-100",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-100",
  slate: "bg-[var(--role-hover)] text-[var(--color-muted,var(--role-text))] dark:bg-slate-800 dark:text-slate-200",
  role: "bg-[var(--role-soft)] text-[var(--role-primary)]",
};

export function Badge({ children, tone = "slate", className }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", tones[tone], className)}>
      {children}
    </span>
  );
}

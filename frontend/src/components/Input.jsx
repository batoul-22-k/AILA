import { cn } from "../utils/cn";

export function Input({ label, hint, error, className, ...props }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-role-text dark:text-slate-200">
      {label}
      <input
        className={cn(
          "adaptive-input focus-ring h-11 border px-4 text-sm text-role-text shadow-sm placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white",
          error && "border-red-400",
          className,
        )}
        {...props}
      />
      {hint && !error && <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{hint}</span>}
      {error && <span className="text-xs font-medium text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

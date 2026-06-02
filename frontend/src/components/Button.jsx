import { Loader2 } from "lucide-react";

import { cn } from "../utils/cn";

const variants = {
  primary: "bg-role-primary text-white shadow-soft hover:brightness-95",
  secondary: "bg-ink text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950",
  ghost: "bg-white/80 text-role-text hover:bg-white dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800",
  outline: "border border-role-border bg-white text-role-text hover:border-role-primary hover:text-role-primary dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  success: "bg-role-secondary text-white hover:brightness-95",
  violet: "bg-violet-600 text-white hover:bg-violet-700 shadow-soft",
  orange: "bg-orange-500 text-white hover:bg-orange-600 shadow-soft",
  role: "bg-role-primary text-white shadow-soft hover:brightness-95",
};

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({ children, className, variant = "primary", size = "md", loading = false, ...props }) {
  return (
    <button
      className={cn(
        "adaptive-button focus-ring inline-flex items-center justify-center gap-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

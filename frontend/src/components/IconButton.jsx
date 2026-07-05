import { cn } from "../utils/cn";

const tones = {
  default: "border-role-border bg-white text-slate-500 hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white",
  role: "border-role-border bg-white text-role-primary hover:border-role-primary hover:bg-role-hover dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900",
  danger: "border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950 dark:hover:bg-red-500/10",
};

const sizes = {
  sm: "h-10 w-10",
  md: "h-10 w-10",
  lg: "h-11 w-11",
};

export function IconButton({ label, icon: Icon, className, iconClassName, tone = "default", size = "md", loading = false, children, ...props }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className={cn(
          "focus-ring inline-grid shrink-0 place-items-center rounded-full border shadow-sm outline-none transition duration-150 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm",
          tones[tone],
          sizes[size],
          className,
        )}
        aria-label={label}
        title={label}
        disabled={loading || props.disabled}
        {...props}
      >
        {Icon && <Icon className={iconClassName} size={19} aria-hidden="true" />}
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-black text-white opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:bg-white dark:text-slate-950">
        {label}
      </span>
    </span>
  );
}

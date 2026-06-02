import { cn } from "../utils/cn";

export function DashboardCard({ children, className, interactive = false, ...props }) {
  const hasCustomSurface = typeof className === "string" && /(^|\s)(dark:)?bg-/.test(className);

  return (
    <section
      className={cn(
        "adaptive-card border transition-all duration-300 ease-in-out dark:border-slate-800/80",
        !hasCustomSurface && "bg-white/95 dark:bg-slate-900/80",
        interactive && "hover:-translate-y-0.5 hover:border-role-accent hover:shadow-lift",
        className,
      )}
      data-interactive={interactive ? "true" : undefined}
      data-surface={hasCustomSurface ? "custom" : undefined}
      {...props}
    >
      {children}
    </section>
  );
}

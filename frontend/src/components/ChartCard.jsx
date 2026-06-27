import { DashboardCard } from "./DashboardCard";

export function ChartCard({ title, subtitle, action, children, className }) {
  return (
    <DashboardCard className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="h-56 min-h-0 w-full rounded-lg bg-[var(--role-hover)]/55 p-3 dark:bg-slate-950/20">{children}</div>
    </DashboardCard>
  );
}

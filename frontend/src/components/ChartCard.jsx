import { DashboardCard } from "./DashboardCard";

export function ChartCard({ title, subtitle, action, children, className }) {
  return (
    <DashboardCard className={className}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-800 dark:text-white sm:text-lg">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="h-64 min-h-0 w-full rounded-[24px] bg-[var(--role-hover)]/70 p-3 dark:bg-slate-950/20">{children}</div>
    </DashboardCard>
  );
}

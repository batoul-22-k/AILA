import { ArrowUpRight } from "lucide-react";

import { cn } from "../utils/cn";
import { Badge } from "./Badge";
import { DashboardCard } from "./DashboardCard";

export function StatCard({ label, value, icon: Icon, tone = "teal", trend, detail, detailPanel }) {
  const iconClass = {
    teal: "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
    gold: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-100",
    red: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-100",
    role: "bg-role-soft text-role-primary dark:bg-[var(--role-dark-soft)] dark:text-[var(--role-dark-text)]",
  };
  const panel = detailPanel || {
    title: `${label} details`,
    description: "Current dashboard metric.",
    items: [
      { label, value },
      ...(detail ? [{ label: "Context", value: detail }] : []),
      ...(trend ? [{ label: "Trend", value: trend }] : []),
    ],
  };

  return (
    <DashboardCard interactive>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">{value}</p>
        </div>
        {Icon && (
          <span className="group relative shrink-0">
            <button
              type="button"
              className={cn("focus-ring grid h-11 w-11 place-items-center rounded-full", iconClass[tone])}
              aria-label={`${label} details`}
            >
              <Icon size={21} />
            </button>
            {panel && (
              <div className="pointer-events-none absolute right-0 top-12 z-30 w-64 translate-y-1 rounded-[18px] border border-role-border bg-white p-3 text-left opacity-0 shadow-lift transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900">
                {panel.title && <p className="text-xs font-black uppercase tracking-wide text-role-text">{panel.title}</p>}
                {panel.description && <p className="mt-1 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{panel.description}</p>}
                <div className="mt-3 grid gap-2">
                  {(panel.items || []).map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{item.label}</span>
                      <span className="text-xs font-black text-slate-950 dark:text-white">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </span>
        )}
      </div>
      {(trend || detail) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {trend && (
            <Badge tone={trend.startsWith("-") ? "red" : "green"}>
              <ArrowUpRight size={13} />
              {trend}
            </Badge>
          )}
          {detail && <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{detail}</span>}
        </div>
      )}
    </DashboardCard>
  );
}

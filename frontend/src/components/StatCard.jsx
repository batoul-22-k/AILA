import { ArrowUpRight } from "lucide-react";

import { cn } from "../utils/cn";
import { Badge } from "./Badge";
import { DashboardCard } from "./DashboardCard";

export function StatCard({ label, value, icon: Icon, tone = "teal", trend, detail }) {
  const iconClass = {
    teal: "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
    gold: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-100",
    red: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-100",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-100",
    role: "bg-role-soft text-role-primary dark:bg-[var(--role-dark-soft)] dark:text-[var(--role-dark-text)]",
  };

  return (
    <DashboardCard interactive>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">{value}</p>
        </div>
        {Icon && (
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", iconClass[tone])}>
            <Icon size={21} />
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

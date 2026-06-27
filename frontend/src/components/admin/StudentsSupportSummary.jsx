import { ArrowRight, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";

function trendCopy(value = 0) {
  const normalized = Number(value || 0);
  if (normalized > 0) return { icon: TrendingUp, text: `+${normalized} this week`, className: "text-red-600" };
  if (normalized < 0) return { icon: TrendingDown, text: `${normalized} this week`, className: "text-emerald-600" };
  return { icon: Users, text: "No weekly change", className: "text-slate-500" };
}

export function StudentsSupportSummary({ summary }) {
  const trend = trendCopy(summary?.weekly_trend || 0);
  const TrendIcon = trend.icon;
  const byClass = summary?.by_class || [];
  const byReason = summary?.by_reason || [];

  return (
    <DashboardCard>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Students needing support</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Support workload summary</h2>
        </div>
        <Link to="/admin/students" className="focus-ring inline-flex h-9 w-fit items-center gap-2 rounded-full border border-role-border bg-white px-3 text-xs font-black text-role-primary transition hover:border-role-primary dark:border-slate-800 dark:bg-slate-950">
          View students
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.7fr_1fr_1fr]">
        <div className="rounded-lg border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <p className="text-xs font-black uppercase text-slate-500">Total at-risk students</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{summary?.total || 0}</p>
          <p className={`mt-3 inline-flex items-center gap-1 text-xs font-black ${trend.className}`}>
            <TrendIcon size={14} />
            {trend.text}
          </p>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Classes with highest support need</p>
          <div className="mt-3 grid gap-2">
            {byClass.length === 0 && <EmptyLine text="No current at-risk class groups." />}
            {byClass.slice(0, 4).map((row) => (
              <div key={row.class_id} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
                <span className="font-black text-slate-800 dark:text-white">{row.class_name}</span>
                <Badge tone="red">{row.students_needing_support}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Top support reasons</p>
          <div className="mt-3 grid gap-2">
            {byReason.length === 0 && <EmptyLine text="No support reasons detected." />}
            {byReason.slice(0, 4).map((row) => (
              <div key={row.reason} className="flex items-center justify-between gap-3 rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{row.reason}</span>
                <Badge tone="gold">{row.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardCard>
  );
}

function EmptyLine({ text }) {
  return <p className="rounded-lg bg-role-hover p-3 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">{text}</p>;
}

import { AlertTriangle, BarChart3, BookOpen, CheckCircle2, Clock } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

const icons = {
  alert: AlertTriangle,
  class: BookOpen,
  prediction: BarChart3,
  review: CheckCircle2,
  session: Clock,
};

function formatDate(value) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
/* 
export function RecentActivityFeed({ activities = [] }) {
  return (
    <DashboardCard className="p-4 shadow-none">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recent activity</p>
        <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Institution activity feed</h2>
      </div>

      <div className="mt-3 grid gap-2">
        {activities.length === 0 && (
          <p className="rounded-lg bg-role-hover p-3 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">
            Recent institutional activity will appear here.
          </p>
        )}
        {activities.slice(0, 7).map((activity) => {
          const Icon = icons[activity.type] || Clock;
          return (
            <div key={`${activity.title}-${activity.created_at}`} className="grid grid-cols-[2rem_1fr] gap-2 rounded-lg bg-role-hover p-2.5 dark:bg-slate-950/40">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-role-primary dark:bg-slate-900">
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-black text-slate-950 dark:text-white">{activity.title}</p>
                <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">{formatDate(activity.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
}
 */
import { AlertCircle, Award, CheckCircle2 } from "lucide-react";

import { cn } from "../utils/cn";
import { Badge } from "./Badge";
import { DashboardCard } from "./DashboardCard";

export function ProgressCard({ label, value, max = 100, badge, tone = "brand" }) {
  const percent = Math.min(100, Math.round((value / max) * 100));
  const colors = {
    brand: "bg-role-primary",
    role: "bg-role-primary",
    emerald: "bg-emerald-500",
    gold: "bg-amber-400",
    violet: "bg-role-primary",
    coral: "bg-coral",
    orange: "bg-orange-500",
  };

  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-white">{label}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {percent >= 100 ? "Complete" : percent <= 0 ? "No activity" : `${percent}% complete`}
          </p>
        </div>
        {badge && (
          <Badge tone="gold">
            <Award size={13} />
            {badge}
          </Badge>
        )}
      </div>
      {percent >= 100 ? (
        <div
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-100"
          title="Perfect score"
          aria-label="100%. Perfect score"
        >
          <CheckCircle2 size={15} className="text-emerald-500 dark:text-emerald-300" />
          100%
        </div>
      ) : percent <= 0 ? (
        <div
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-700 dark:bg-red-400/10 dark:text-red-100"
          title="No activity recorded"
          aria-label="0%. No activity recorded"
        >
          <AlertCircle size={15} className="text-red-400 dark:text-red-300" />
          0%
        </div>
      ) : (
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={cn("h-full rounded-full transition-all duration-700", colors[tone])} style={{ width: `${percent}%` }} />
        </div>
      )}
    </DashboardCard>
  );
}

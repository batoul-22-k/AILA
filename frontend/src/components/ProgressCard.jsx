import { Award } from "lucide-react";

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
    violet: "bg-violet-500",
    coral: "bg-coral",
    orange: "bg-orange-500",
  };

  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-950 dark:text-white">{label}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{percent}% complete</p>
        </div>
        {badge && (
          <Badge tone="gold">
            <Award size={13} />
            {badge}
          </Badge>
        )}
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={cn("h-full rounded-full transition-all duration-700", colors[tone])} style={{ width: `${percent}%` }} />
      </div>
    </DashboardCard>
  );
}

import { Lightbulb } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

/* export function AdminRecommendations({ recommendations = [] }) {
  return (
    <DashboardCard>
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-1 text-role-primary" size={22} />
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recommended actions</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Institution support queue</h2>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {recommendations.length === 0 && (
          <p className="rounded-lg bg-role-hover p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">
            No urgent recommendations right now.
          </p>
        )}
        {recommendations.slice(0, 6).map((item) => (
          <div key={`${item.title}-${item.source}`} className="rounded-xl border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="font-black text-slate-950 dark:text-white">{item.title}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{item.reason}</p>
            <p className="mt-2 text-xs font-black uppercase tracking-wide text-role-primary">{item.source}</p>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
} */

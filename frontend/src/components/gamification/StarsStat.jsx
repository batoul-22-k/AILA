import { Star } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

export function StarsStat({ stars = 0, loading }) {
  return (
    <DashboardCard className="min-h-36">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black uppercase text-slate-500 dark:text-slate-400">Stars</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">
            {loading ? "..." : Number(stars || 0).toLocaleString()}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100">
          <Star size={22} fill="currentColor" />
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Earned from correct answers, missions, and session milestones.</p>
    </DashboardCard>
  );
}

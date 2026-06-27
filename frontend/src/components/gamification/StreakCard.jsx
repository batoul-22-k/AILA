import { Flame } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

export function StreakCard({ current = 0, longest = 0, loading }) {
  return (
    <DashboardCard className="min-h-36">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black uppercase text-slate-500 dark:text-slate-400">Current streak</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">
            {loading ? "..." : `${Number(current || 0)} days`}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-100">
          <Flame size={23} />
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Longest streak: <span className="text-slate-800 dark:text-slate-100">{Number(longest || 0)} days</span></p>
    </DashboardCard>
  );
}

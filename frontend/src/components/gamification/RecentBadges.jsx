import { Award } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";
import { LoadingSkeleton } from "../LoadingSkeleton";

export function RecentBadges({ badges, loading }) {
  const earned = (badges?.earned || badges?.unlocked || []).slice(0, 4);

  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Recent Badges</h2>
        <Link to="/student/achievements">
          <Button size="sm" variant="outline">View all</Button>
        </Link>
      </div>
      {loading && (
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 3 }).map((_, index) => <LoadingSkeleton key={index} className="h-14" />)}
        </div>
      )}
      {!loading && earned.length === 0 && <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">No badges yet.</p>}
      <div className="mt-4 grid gap-2">
        {earned.map((badge) => (
          <div key={badge.badge_id} className="flex min-h-14 items-center gap-3 rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 dark:border-amber-400/15 dark:bg-amber-400/10">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100">
              <Award size={18} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-950 dark:text-white">{badge.title}</p>
              <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{badge.description}</p>
            </div>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

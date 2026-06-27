import { CheckCircle2, Circle, Gift, Loader2, Target } from "lucide-react";

import { Badge } from "../Badge";
import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";

export function DailyMissionsCard({ mission, loading, error, onClaim, claiming }) {
  const tasks = mission?.tasks || [];
  const canClaim = mission?.completed && !mission?.claimed;
  const progress = Math.round(Number(mission?.progress_percentage || 0));

  return (
    <DashboardCard>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge tone="role">Today</Badge>
          <h2 className="mt-2 text-lg font-black text-slate-950 dark:text-white">{mission?.title || "Daily Missions"}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {mission?.date_key || "Build your daily learning rhythm."}
          </p>
        </div>
        <div className="w-full rounded-xl border border-role-border bg-role-hover p-3 dark:border-slate-800 dark:bg-slate-950/40 sm:w-40">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              <Target size={14} />
              Progress
            </p>
            <p className="text-sm font-black text-role-primary">{progress}%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white dark:bg-slate-800">
            <div className="h-full rounded-full bg-role-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {loading && (
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-role-hover p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">
          <Loader2 className="animate-spin" size={16} />
          Loading missions
        </div>
      )}
      {error && <p className="mt-5 rounded-lg bg-red-50 p-4 text-sm font-semibold text-red-700 dark:bg-red-400/10 dark:text-red-100">{error}</p>}
      {!loading && !error && !mission && (
        <p className="mt-5 rounded-lg border border-dashed border-role-border p-4 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-300">No mission is available yet.</p>
      )}

      {tasks.length > 0 && (
        <div className="mt-5 divide-y divide-role-border overflow-hidden rounded-xl border border-role-border dark:divide-slate-800 dark:border-slate-800">
          {tasks.map((task) => (
            <div key={task.key} className="grid min-h-14 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 bg-white/80 px-3 py-2.5 dark:bg-slate-950/30">
              {task.completed ? <CheckCircle2 className="text-emerald-600" size={17} /> : <Circle className="text-slate-400" size={17} />}
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900 dark:text-white">{task.label}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-role-primary" style={{ width: `${Math.min((Number(task.progress || 0) / Math.max(Number(task.target || 1), 1)) * 100, 100)}%` }} />
                </div>
              </div>
              <span className="text-xs font-black text-slate-500 dark:text-slate-400">{task.progress}/{task.target}</span>
            </div>
          ))}
        </div>
      )}

      {mission && (
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-200/70 bg-amber-50 p-3 dark:border-amber-400/15 dark:bg-amber-400/10 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm font-black text-amber-800 dark:text-amber-100">
            <Gift size={17} />
            +{mission.reward?.xp || 0} XP · +{mission.reward?.stars || 0} stars
          </p>
          {canClaim && (
            <Button size="sm" variant="role" loading={claiming} onClick={() => onClaim?.(mission)}>
              Claim reward
            </Button>
          )}
          {mission.claimed && <Badge tone="green">Claimed</Badge>}
        </div>
      )}
    </DashboardCard>
  );
}

import { cn } from "../../utils/cn";

function clampPercent(value) {
  return Math.max(0, Math.min(Number(value || 0), 100));
}

export function XPProgressBar({ profile, compact = false, className }) {
  const percent = clampPercent(profile?.level_progress_percent);
  const current = Number(profile?.current_level_progress || 0);
  const needed = Number(profile?.next_level_xp || 0) - Number(profile?.current_level_xp || 0);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className={cn("font-bold text-slate-700 dark:text-slate-200", compact ? "text-xs" : "text-sm")}>XP Progress</span>
        <span className={cn("font-black text-role-primary", compact ? "text-xs" : "text-sm")}>
          {current.toLocaleString()} XP
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70 dark:bg-slate-800 dark:ring-slate-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-600 transition-all duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
      {!compact && (
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>{current.toLocaleString()} / {Math.max(needed, 0).toLocaleString()} XP</span>
          <span>{percent}%</span>
        </div>
      )}
    </div>
  );
}

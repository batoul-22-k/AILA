import { ArrowRight, Award, Flame, Medal, Star, Trophy, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";
import { cn } from "../../utils/cn";

const periodTabs = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "all_time", label: "All-time" },
];

function rankStyle(rank) {
  if (rank === 1) return "border-amber-300 bg-amber-100 text-amber-800 shadow-[0_8px_18px_rgba(217,119,6,0.14)] dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100";
  if (rank === 2) return "border-slate-300 bg-slate-100 text-slate-700 shadow-[0_8px_18px_rgba(100,116,139,0.12)] dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-100";
  if (rank === 3) return "border-orange-300 bg-orange-100 text-orange-800 shadow-[0_8px_18px_rgba(234,88,12,0.12)] dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-100";
  return "border-role-border bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300";
}

function rowRankStyle(rank) {
  if (rank === 1) return "border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-white shadow-[0_12px_28px_rgba(217,119,6,0.08)] dark:border-amber-500/20 dark:from-amber-500/10 dark:via-slate-950/45 dark:to-slate-950/35";
  if (rank === 2) return "border-slate-200 bg-gradient-to-r from-slate-100 via-white to-white shadow-[0_10px_24px_rgba(100,116,139,0.07)] dark:border-slate-500/20 dark:from-slate-500/10 dark:via-slate-950/45 dark:to-slate-950/35";
  if (rank === 3) return "border-orange-200/80 bg-gradient-to-r from-orange-50 via-white to-white shadow-[0_10px_24px_rgba(234,88,12,0.07)] dark:border-orange-500/20 dark:from-orange-500/10 dark:via-slate-950/45 dark:to-slate-950/35";
  return "border-transparent bg-slate-50/80 hover:bg-role-hover dark:bg-slate-950/50";
}

function rankLabel(rank) {
  if (rank === 1) return "1";
  if (rank === 2) return "2";
  if (rank === 3) return "3";
  return `#${rank}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function LeaderboardSkeleton({ compact }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: compact ? 5 : 8 }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

function LeaderboardRow({ row, compact }) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition",
        compact ? "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[auto_1fr_auto] lg:grid-cols-[auto_1.2fr_auto_auto_auto_auto]",
        rowRankStyle(row.rank),
        row.is_current_student && "border-role-primary/35 shadow-[inset_3px_0_0_var(--role-primary),0_10px_26px_rgba(43,120,134,0.08)]",
      )}
    >
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-full border text-xs font-black", rankStyle(row.rank))}>
        {row.rank <= 3 ? (
          <span className="inline-flex items-center gap-0.5">
            <Medal size={15} />
            {rankLabel(row.rank)}
          </span>
        ) : `#${row.rank}`}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-black text-slate-950 dark:text-white">{row.student_name || "Student"}</p>
          {row.is_current_student && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-role-primary ring-1 ring-role-border dark:bg-slate-900">
              You
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{formatNumber(row.xp)} XP</p>
      </div>

      <div className={cn(
        "flex flex-wrap items-center gap-3 text-xs font-black text-slate-600 dark:text-slate-300",
        compact ? "col-span-2 justify-start pl-12 sm:col-span-1 sm:justify-end sm:pl-0" : "justify-end",
      )}>
        <span className="inline-flex items-center gap-1">
          <Trophy size={14} className="text-role-primary" />
          Level {row.level || 1}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star size={14} className="text-amber-500" />
          {formatNumber(row.stars)}
        </span>
      </div>

      {!compact && (
        <>
          <span className="hidden items-center justify-end gap-1 text-xs font-black text-slate-500 dark:text-slate-400 lg:inline-flex">
            <Award size={14} />
            {formatNumber(row.badges_count)}
          </span>
          <span className="hidden items-center justify-end gap-1 text-xs font-black text-slate-500 dark:text-slate-400 lg:inline-flex">
            <Flame size={14} />
            {formatNumber(row.streak)}
          </span>
          <span className="hidden text-right text-xs font-black text-slate-400 lg:block">#{row.rank}</span>
        </>
      )}
    </div>
  );
}

export function ClassLeaderboard({
  leaderboard,
  period = "weekly",
  onPeriodChange,
  onRetry,
  loading = false,
  error = "",
  compact = false,
}) {
  const rows = leaderboard?.rows || [];
  const displayRows = compact ? rows.slice(0, 5) : rows;
  const currentRow = rows.find((row) => row.is_current_student);
  const currentRank = leaderboard?.current_student_rank || currentRow?.rank;

  return (
    <DashboardCard className="overflow-hidden p-0">
      <div className="border-b border-role-border bg-gradient-to-r from-white via-role-hover to-white px-5 py-4 dark:from-slate-900 dark:via-slate-900/80 dark:to-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-role-soft text-role-primary dark:bg-role-dark-soft">
              <Trophy size={20} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">{compact ? "Weekly challenge" : "Class competition"}</p>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Class Leaderboard</h2>
            </div>
          </div>

          {!compact && (
            <div className="flex rounded-full border border-role-border bg-white p-1 dark:bg-slate-950">
              {periodTabs.map((tab) => (
                <button
                  key={tab.key}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-black transition",
                    period === tab.key ? "bg-role-primary text-white" : "text-slate-500 hover:bg-role-hover dark:text-slate-300",
                  )}
                  type="button"
                  onClick={() => onPeriodChange?.(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {compact && (
            <Link to="/student/leaderboard">
              <Button variant="outline" size="sm">
                View all
                <ArrowRight size={14} />
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div className="rounded-xl border border-role-border bg-role-hover p-5 text-center dark:border-slate-800 dark:bg-slate-950/40">
            <Users className="mx-auto text-role-primary" size={28} />
            <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No leaderboard data available yet.</p>
            <p className="mx-auto mt-1 max-w-md text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Be among the first students to earn XP, collect stars, and climb the rankings.
            </p>
            {onRetry && (
              <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}

        {!error && loading && <LeaderboardSkeleton compact={compact} />}

        {!error && !loading && displayRows.length === 0 && (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-role-border bg-role-hover p-6 text-center dark:bg-slate-950/40">
            <Users className="text-role-primary" size={26} />
            <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No leaderboard data available yet.</p>
            <p className="mt-1 max-w-md text-sm font-semibold text-slate-500 dark:text-slate-400">
              Be among the first students to earn XP, collect stars, and climb the rankings.
            </p>
          </div>
        )}

        {!error && !loading && displayRows.length > 0 && (
          <div className="space-y-2">
            {!compact && (
              <div className="hidden grid-cols-[auto_1.2fr_auto_auto_auto_auto] gap-3 px-3 text-[11px] font-black uppercase tracking-wide text-slate-400 lg:grid">
                <span>Rank</span>
                <span>Student</span>
                <span className="text-right">Level / Stars</span>
                <span className="text-right">Badges</span>
                <span className="text-right">Streak</span>
                <span className="text-right">Place</span>
              </div>
            )}
            {displayRows.map((row) => (
              <LeaderboardRow key={`${row.student_id}-${row.rank}`} row={row} compact={compact} />
            ))}
          </div>
        )}

        {!error && !loading && currentRank && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg bg-role-hover p-3 text-sm font-semibold text-slate-600 dark:bg-slate-950/50 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <span>Your current position</span>
            <span className="font-black text-role-primary">#{currentRank}</span>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

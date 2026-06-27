import { Sparkles, Trophy } from "lucide-react";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";

export function SessionRewardSummary({ summary, loading, error }) {
  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge tone="emerald">Session summary</Badge>
          <h2 className="mt-2 text-lg font-black text-slate-950 dark:text-white">Rewards Earned</h2>
        </div>
        <Trophy className="text-amber-600" size={24} />
      </div>
      {loading && <p className="mt-5 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading session rewards...</p>}
      {error && <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>}
      {!loading && !error && !summary && (
        <div className="mt-5 rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:bg-slate-950/40">
          <Sparkles className="mx-auto text-role-primary" size={24} />
          <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No session rewards yet</p>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Complete a live session to see XP, stars, badges, and level progress here.</p>
        </div>
      )}
      {summary && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-role-hover p-4 transition duration-300 hover:-translate-y-0.5 dark:bg-slate-950/40">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">XP earned</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">+{summary.xp_earned || 0}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4 transition duration-300 hover:-translate-y-0.5 dark:bg-amber-400/10">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-100">Stars earned</p>
              <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-100">+{summary.stars_earned || 0}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-4 transition duration-300 hover:-translate-y-0.5 dark:bg-emerald-400/10">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-100">Level</p>
              <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-100">{summary.level_before} → {summary.level_after}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={summary.leveled_up ? "emerald" : "slate"}>{summary.leveled_up ? "Leveled up" : "Level steady"}</Badge>
            <Badge tone="gold">{summary.badges_unlocked || 0} badges</Badge>
          </div>
        </>
      )}
    </DashboardCard>
  );
}

import { Award, Flame, GraduationCap, Sparkles, Star, Trophy } from "lucide-react";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";
import { XPProgressBar } from "./XPProgressBar";
import { cn } from "../../utils/cn";

function statItems(profile, rank) {
  return [
    { label: "Stars", value: Number(profile?.stars || 0).toLocaleString(), icon: Star, tone: "text-amber-500", fill: true },
    { label: "Rank", value: rank ? `#${rank}` : "Build XP", icon: Trophy, tone: "text-role-primary" },
    { label: "Streak", value: `${Number(profile?.current_streak || 0)} day${Number(profile?.current_streak || 0) === 1 ? "" : "s"}`, icon: Flame, tone: "text-emerald-600" },
    { label: "Badges", value: Number(profile?.badges_count || 0).toLocaleString(), icon: Award, tone: "text-amber-600" },
  ];
}

export function LevelProfileCard({ profile, loading, error, className, compact = false, rank }) {
  if (loading) {
    return (
      <DashboardCard className={className}>
        <div className={compact ? "h-28 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" : "h-32 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"} />
      </DashboardCard>
    );
  }

  if (error) {
    return (
      <DashboardCard className={className}>
        <p className="text-sm font-semibold text-red-600">{error}</p>
      </DashboardCard>
    );
  }

  const items = statItems(profile, rank);
  const xpToNext = Number(profile?.xp_to_next_level || 0);
  const nextLevel = Number(profile?.level || 1) + 1;

  return (
    <DashboardCard
      className={cn(
        "overflow-hidden border-role-border bg-gradient-to-br from-white via-[#f8fffb] to-[#eefaf4] shadow-[0_18px_45px_rgba(15,23,42,0.06)] dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20",
        compact ? "p-5" : "p-5 sm:p-6",
        className,
      )}
    >
      <div className={cn("grid gap-5", compact ? "" : "xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-stretch")}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-role-primary text-white shadow-soft", compact ? "h-12 w-12" : "h-14 w-14")}>
              <GraduationCap size={compact ? 23 : 27} />
            </div>
            <div className="min-w-0 flex-1">
              <Badge tone="emerald">Reward profile</Badge>
              <h2 className={cn("mt-2 truncate font-black text-slate-950 dark:text-white", compact ? "text-2xl" : "text-3xl")}>
                Level {profile?.level || 1} Scholar
              </h2>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                Your progress through this class journey.
              </p>
            </div>
          </div>

          <div className={compact ? "mt-5" : "mt-6"}>
            <XPProgressBar profile={profile} />
          </div>

          <div className="mt-4 rounded-xl border border-role-border bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/35">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-role-primary">
              <Sparkles size={14} />
              Next Reward
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
              Earn <span className="font-black text-slate-950 dark:text-white">{xpToNext.toLocaleString()} XP</span> to reach Level {nextLevel}.
            </p>
          </div>
        </div>

        <div className={cn("grid gap-3", compact ? "sm:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-1")}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-xl border border-role-border bg-white/75 p-3 transition duration-300 hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-950/35">
                <p className="flex items-center gap-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                  <Icon size={15} className={item.tone} fill={item.fill ? "currentColor" : "none"} />
                  {item.label}
                </p>
                <p className={compact ? "mt-1.5 text-lg font-black text-slate-950 dark:text-white" : "mt-2 text-2xl font-black text-slate-950 dark:text-white"}>{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardCard>
  );
}

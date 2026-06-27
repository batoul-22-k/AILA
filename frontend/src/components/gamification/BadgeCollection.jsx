import { Award, GraduationCap, Lock, Sparkles, Target } from "lucide-react";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";
import { LoadingSkeleton } from "../LoadingSkeleton";

function progressText(badge, locked) {
  const progress = Number(badge.progress || 0);
  const target = Number(badge.target || 1);
  if (!locked) return target > 1 ? `${target} / ${target}` : "Completed";
  if (String(badge.badge_key || "").includes("scholar") || /level/i.test(badge.description || "")) {
    return `Level ${progress} / ${target}`;
  }
  return `${progress} / ${target}`;
}

function requirementText(badge) {
  if (badge.description) return badge.description;
  if (badge.target) return `Reach ${badge.target} progress`;
  return "Keep participating to unlock this badge.";
}

function BadgeIcon({ badge, locked }) {
  if (String(badge.badge_key || "").includes("scholar")) return <GraduationCap size={21} />;
  if (locked) return <Lock size={19} />;
  return <Award size={21} />;
}

function BadgeTile({ badge, locked }) {
  const percent = Math.min(Number(badge.progress_percentage || (locked ? 0 : 100)), 100);
  return (
    <div className={`rounded-xl border p-4 transition duration-300 hover:-translate-y-0.5 ${locked ? "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/30" : "border-amber-200/80 bg-gradient-to-br from-white to-amber-50/80 shadow-[0_12px_26px_rgba(180,83,9,0.08)] dark:border-amber-400/15 dark:from-slate-950/45 dark:to-amber-950/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${locked ? "bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" : "bg-amber-100 text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-400/15"}`}>
          <BadgeIcon badge={badge} locked={locked} />
        </div>
        <Badge tone={locked ? "slate" : "gold"}>{locked ? `${Math.round(badge.progress_percentage || 0)}%` : "Earned"}</Badge>
      </div>
      <h3 className="mt-3 text-sm font-black text-slate-950 dark:text-white">{badge.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{badge.description}</p>
      <div className="mt-3 rounded-lg bg-white/70 p-3 ring-1 ring-role-border dark:bg-slate-900/50 dark:ring-slate-800">
        <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Target size={12} />
          Unlock requirement
        </p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{requirementText(badge)}</p>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs font-black text-slate-500 dark:text-slate-400">
          <span>Progress</span>
          <span>{progressText(badge, locked)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full transition-all duration-700 ${locked ? "bg-role-primary" : "bg-amber-500"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}

export function BadgeCollection({ badges, loading, error, compact = false }) {
  const earned = badges?.earned || badges?.unlocked || [];
  const locked = badges?.locked || [];
  const visibleEarned = compact ? earned.slice(0, 6) : earned;
  const visibleLocked = compact ? locked.slice(0, 6) : locked;

  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge tone="gold">Achievements</Badge>
          <h2 className="mt-2 text-lg font-black text-slate-950 dark:text-white">Badge Collection</h2>
        </div>
        <p className="text-sm font-black text-slate-500 dark:text-slate-400">{earned.length} earned · {locked.length} locked</p>
      </div>
      {loading && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: compact ? 3 : 6 }).map((_, index) => <LoadingSkeleton key={index} className="h-44" />)}
        </div>
      )}
      {error && <p className="mt-5 text-sm font-semibold text-red-600">{error}</p>}
      {!loading && !error && earned.length === 0 && locked.length === 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:border-slate-700 dark:bg-slate-950/40">
          <Award className="mx-auto text-role-primary" size={26} />
          <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No badges yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
            You have not unlocked any badges yet. Answer questions and participate to earn your first achievement.
          </p>
        </div>
      )}
      {visibleEarned.length > 0 && (
        <div className="mt-5">
          <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-100">
            <Sparkles size={14} />
            Earned
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleEarned.map((badge) => <BadgeTile key={badge.badge_id || badge.badge_key} badge={badge} />)}
          </div>
        </div>
      )}
      {visibleLocked.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Lock size={14} />
            Locked
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleLocked.map((badge) => <BadgeTile key={badge.badge_key} badge={badge} locked />)}
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

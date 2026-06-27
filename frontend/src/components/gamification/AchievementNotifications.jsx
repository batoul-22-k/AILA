import { Award, Bell, CheckCheck, Flame, Sparkles, TrendingUp } from "lucide-react";

import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";

function dateLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function IconForNotification({ type }) {
  if (type === "badge") return <Award size={16} />;
  if (type === "level") return <TrendingUp size={16} />;
  if (type === "streak") return <Flame size={16} />;
  if (type === "session_reward") return <Sparkles size={16} />;
  return <Bell size={16} />;
}

export function AchievementNotifications({ notifications = [], loading, error, onRead, onReadAll }) {
  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Achievement Notifications</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{notifications.length} recent</p>
        </div>
        <Button size="sm" variant="outline" onClick={onReadAll} disabled={notifications.length === 0}>
          <CheckCheck size={15} />
          Read all
        </Button>
      </div>
      {loading && <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading notifications...</p>}
      {error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}
      {!loading && !error && notifications.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:bg-slate-950/40">
          <Bell className="mx-auto text-role-primary" size={24} />
          <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No new achievements yet</p>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Complete a mission, earn a badge, or level up to see updates here.</p>
        </div>
      )}
      <div className="mt-4 grid gap-2">
        {notifications.slice(0, 6).map((item) => (
          <button key={item.achievement_notification_id} type="button" onClick={() => onRead?.(item)} className="focus-ring grid min-h-14 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-role-border bg-white/90 px-3 py-2 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950/35">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-role-soft text-role-primary dark:bg-slate-900">
              <IconForNotification type={item.achievement_type} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{item.title}</span>
              <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{item.description}</span>
            </span>
            <span className="text-xs font-bold text-slate-400">{dateLabel(item.created_at)}</span>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
}

import { Award, Flame, Sparkles, Star, Trophy } from "lucide-react";

import { DashboardCard } from "../DashboardCard";
import { LoadingSkeleton } from "../LoadingSkeleton";

function timeLabel(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function eventTitle(event) {
  if (event.event_type === "correct_answer") return "Correct Answer";
  if (event.event_type === "mission_claim") return "Mission Complete";
  if (event.event_type === "weekly_challenge_claim") return "Weekly Challenge";
  if (event.event_type === "perfect_session") return "Perfect Session";
  return String(event.event_type || "Reward").replaceAll("_", " ");
}

function buildItems({ badges, notifications, history }) {
  const badgeItems = (badges?.earned || badges?.unlocked || []).map((badge) => ({
    id: `badge-${badge.badge_id || badge.badge_key}`,
    title: badge.title || "Badge unlocked",
    subtitle: "Badge unlocked",
    date: badge.unlocked_at,
    icon: Award,
    tone: "text-amber-600 bg-amber-100 dark:bg-amber-400/15 dark:text-amber-100",
  }));
  const notificationItems = (notifications || []).map((notification) => ({
    id: `notice-${notification.achievement_notification_id}`,
    title: notification.title || "Achievement",
    subtitle: notification.description || "Progress updated",
    date: notification.created_at,
    icon: notification.achievement_type === "streak" ? Flame : Trophy,
    tone: "text-role-primary bg-role-soft dark:bg-role-dark-soft",
  }));
  const rewardItems = (history || []).filter((event) => Number(event.xp_delta || 0) > 0 || Number(event.stars_delta || 0) > 0).map((event, index) => ({
    id: `event-${event.event_type}-${event.created_at}-${index}`,
    title: Number(event.stars_delta || 0) > 0 ? `Earned ${event.stars_delta} Stars` : eventTitle(event),
    subtitle: `+${event.xp_delta || 0} XP${Number(event.stars_delta || 0) > 0 ? ` · +${event.stars_delta} stars` : ""}`,
    date: event.created_at,
    icon: Number(event.stars_delta || 0) > 0 ? Star : Sparkles,
    tone: Number(event.stars_delta || 0) > 0 ? "text-amber-600 bg-amber-100 dark:bg-amber-400/15 dark:text-amber-100" : "text-role-primary bg-role-soft dark:bg-role-dark-soft",
  }));
  return [...badgeItems, ...notificationItems, ...rewardItems]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 5);
}

export function RecentAchievementsPanel({ badges, notifications, history, loading }) {
  const items = buildItems({ badges, notifications, history });

  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recent achievement</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Latest Progress</h2>
        </div>
        <Trophy className="text-role-primary" size={21} />
      </div>
      {loading && (
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 3 }).map((_, index) => <LoadingSkeleton key={index} className="h-14" />)}
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:bg-slate-950/40">
          <Sparkles className="mx-auto text-role-primary" size={24} />
          <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">Your first achievement is waiting</p>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Join a session, answer a question, or complete a mission to start your collection.</p>
        </div>
      )}
      {items.length > 0 && (
        <div className="mt-4 grid gap-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="grid min-h-14 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-role-border bg-white/85 px-3 py-2.5 transition duration-300 hover:-translate-y-0.5 hover:bg-role-hover dark:border-slate-800 dark:bg-slate-950/35">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.tone}`}>
                  <Icon size={17} fill={item.icon === Star ? "currentColor" : "none"} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black capitalize text-slate-950 dark:text-white">{item.title}</span>
                  <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{item.subtitle}</span>
                </span>
                <span className="text-xs font-black text-slate-400">{timeLabel(item.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

import { Award, CheckCircle2, Clock, Flame, LogIn, Sparkles, Star, Target, Trophy } from "lucide-react";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";
import { LoadingSkeleton } from "../LoadingSkeleton";

function eventLabel(value) {
  if (value === "correct_answer") return "Correct Answer";
  if (value === "answer_question") return "Question Answered";
  if (value === "join_session") return "Joined Session";
  if (value === "mission_claim") return "Mission Reward Claimed";
  if (value === "weekly_challenge_claim") return "Challenge Reward Claimed";
  if (value === "perfect_session") return "Perfect Session";
  if (value === "level_up_bonus") return "Level Up Bonus";
  return String(value || "Reward").replaceAll("_", " ");
}

function dateLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function EventIcon({ type }) {
  if (type === "join_session") return <LogIn size={16} />;
  if (type === "answer_question") return <CheckCircle2 size={16} />;
  if (type === "correct_answer") return <Target size={16} />;
  if (type === "perfect_session") return <Trophy size={16} />;
  if (type === "mission_claim") return <Award size={16} />;
  if (type === "weekly_challenge_claim") return <Trophy size={16} />;
  if (type === "level_up_bonus") return <Sparkles size={16} />;
  if (String(type || "").includes("streak")) return <Flame size={16} />;
  return <Sparkles size={16} />;
}

export function GamificationHistory({ events = [], loading, error }) {
  return (
    <DashboardCard>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recent activity</p>
          <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Rewards and Progress</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Latest XP gains, stars, missions, and challenge rewards.</p>
        </div>
        <Clock className="text-role-primary" size={20} />
      </div>
      {loading && (
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => <LoadingSkeleton key={index} className="h-14" />)}
        </div>
      )}
      {error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:bg-slate-950/40">
          <Sparkles className="mx-auto text-role-primary" size={24} />
          <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No activity yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
            Your achievements and rewards will appear here as you participate.
          </p>
        </div>
      )}
      {events.length > 0 && (
        <div className="mt-4 divide-y divide-role-border overflow-hidden rounded-xl border border-role-border dark:divide-slate-800 dark:border-slate-800">
          {events.slice(0, 8).map((event, index) => (
            <div key={`${event.event_type}-${event.created_at}-${index}`} className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 bg-white/75 px-3 py-2.5 transition duration-300 hover:bg-role-hover dark:bg-slate-950/25">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-role-soft text-role-primary dark:bg-slate-900">
              <EventIcon type={event.event_type} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black capitalize text-slate-950 dark:text-white">{eventLabel(event.event_type)}</p>
              <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                {event.source_type ? `${String(event.source_type).replaceAll("_", " ")} · ` : ""}{dateLabel(event.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
              <Badge tone="emerald">+{event.xp_delta || 0} XP</Badge>
              {Number(event.stars_delta || 0) > 0 && (
                <Badge tone="gold">
                  <Star size={12} fill="currentColor" />
                  +{event.stars_delta}
                </Badge>
              )}
            </div>
          </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

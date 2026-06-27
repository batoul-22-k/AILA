import { CheckCircle2, Flame, HelpCircle, Radio, Star, Target, Trophy } from "lucide-react";

import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";
import { cn } from "../../utils/cn";

const metricIcons = {
  answer_question: HelpCircle,
  correct_answer: Target,
  join_session: Radio,
  stars_earned: Star,
  streak_days: Flame,
};

const starterChallenges = [
  {
    challenge_id: "starter-join-session",
    title: "Join 1 session",
    description: "Enter a live class session this week.",
    metric_type: "join_session",
    target: 1,
    reward: { xp: 20, stars: 0 },
    progress: { progress: 0, completed: false, claimed: false },
    progress_percentage: 0,
  },
  {
    challenge_id: "starter-answer-questions",
    title: "Answer 3 questions",
    description: "Participate in live questions to build momentum.",
    metric_type: "answer_question",
    target: 3,
    reward: { xp: 15, stars: 0 },
    progress: { progress: 0, completed: false, claimed: false },
    progress_percentage: 0,
  },
  {
    challenge_id: "starter-earn-stars",
    title: "Earn 10 stars",
    description: "Get correct answers and complete activities.",
    metric_type: "stars_earned",
    target: 10,
    reward: { xp: 10, stars: 0 },
    progress: { progress: 0, completed: false, claimed: false },
    progress_percentage: 0,
  },
];

function formatReward(reward) {
  const xp = Number(reward?.xp || 0);
  const stars = Number(reward?.stars || 0);
  return `+${xp} XP${stars ? ` / +${stars} Stars` : ""}`;
}

function ChallengeSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

export function WeeklyChallengesCard({
  challengesData,
  loading = false,
  error = "",
  onClaim,
  claimingId = "",
  limit = 3,
}) {
  const hasChallengeData = Boolean(challengesData);
  const rawChallenges = challengesData?.challenges || [];
  const challenges = (hasChallengeData && rawChallenges.length === 0 ? starterChallenges : rawChallenges).slice(0, limit);

  return (
    <DashboardCard className="overflow-hidden p-0">
      <div className="border-b border-role-border bg-gradient-to-r from-white via-role-hover to-white px-5 py-4 dark:from-slate-900 dark:via-slate-900/80 dark:to-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-role-soft text-role-primary dark:bg-role-dark-soft">
              <Trophy size={20} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Weekly challenges</p>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">This Week</h2>
            </div>
          </div>
          {challengesData?.week_key && (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-role-border dark:bg-slate-950 dark:text-slate-300">
              {challengesData.week_key}
            </span>
          )}
        </div>
      </div>

      <div className="p-5">
        {error && (
          <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        )}

        {!error && loading && <ChallengeSkeleton />}

        {!error && !loading && !hasChallengeData && challenges.length === 0 && (
          <div className="rounded-xl border border-dashed border-role-border bg-role-hover p-5 text-center dark:bg-slate-950/40">
            <Trophy className="mx-auto text-role-primary" size={24} />
            <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">Choose a class to see weekly challenges</p>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Challenges appear once your class workspace is selected.</p>
          </div>
        )}

        {!error && !loading && challenges.length > 0 && (
          <div className="space-y-3">
            {challenges.map((challenge) => {
              const progress = challenge.progress || {};
              const percent = Math.min(Number(challenge.progress_percentage || 0), 100);
              const completed = Boolean(progress.completed);
              const claimed = Boolean(progress.claimed);
              const canClaim = completed && !claimed;
              const Icon = metricIcons[challenge.metric_type] || Trophy;

              return (
                <div
                  key={challenge.challenge_id}
                  className={cn(
                    "rounded-xl border p-4 transition",
                    completed
                      ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                      : "border-role-border bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", completed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-role-soft text-role-primary dark:bg-role-dark-soft")}>
                      {claimed ? <CheckCircle2 size={19} /> : <Icon size={19} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <div className="min-w-0">
                          <h3 className="text-sm font-black leading-5 text-slate-950 dark:text-white sm:text-base">{challenge.title}</h3>
                          <p className="mt-1 whitespace-normal text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{challenge.description}</p>
                        </div>
                        <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100 dark:bg-slate-900 dark:text-amber-200 dark:ring-amber-500/20 lg:justify-self-end">
                          {formatReward(challenge.reward)}
                        </span>
                      </div>

                      <div className="mt-3">
                        <div className="mb-1.5 flex items-center justify-between text-xs font-black text-slate-500 dark:text-slate-400">
                          <span>
                            {Number(progress.progress || 0)} / {Number(challenge.target || 0)}
                          </span>
                          <span>{Math.round(percent)}%</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-role-border dark:bg-slate-900 dark:ring-slate-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-role-primary transition-all duration-700" style={{ width: `${percent}%` }} />
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className={cn("text-xs font-black", claimed ? "text-emerald-700 dark:text-emerald-200" : completed ? "text-role-primary" : "text-slate-400")}>
                          {claimed ? "Reward claimed" : completed ? "Completed" : "In progress"}
                        </span>
                        {canClaim && !String(challenge.challenge_id).startsWith("starter-") && (
                          <Button size="sm" variant="role" loading={claimingId === challenge.challenge_id} disabled={Boolean(claimingId)} onClick={() => onClaim?.(challenge)}>
                            Claim
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

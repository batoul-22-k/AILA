import { ArrowRight, Award, TrendingUp, Star, Trophy } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

const steps = [
  { label: "Earn Stars", helper: "Correct answers", icon: Star, className: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100", fill: true },
  { label: "Gain XP", helper: "Participation", icon: TrendingUp, className: "bg-role-soft text-role-primary dark:bg-role-dark-soft" },
  { label: "Level Up", helper: "Progression", icon: Trophy, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" },
  { label: "Unlock Badges", helper: "Achievements", icon: Award, className: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200" },
];

export function RewardLoopCard() {
  return (
    <DashboardCard className="p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">How progress works</p>
          <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Your reward loop</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[34rem]">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="flex min-w-0 items-center gap-2 rounded-xl border border-role-border bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/35">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${step.className}`}>
                  <Icon size={16} fill={step.fill ? "currentColor" : "none"} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-black text-slate-950 dark:text-white">{step.label}</span>
                  <span className="block truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{step.helper}</span>
                </span>
                {index < steps.length - 1 && <ArrowRight className="ml-auto hidden shrink-0 text-slate-300 xl:block" size={14} />}
              </div>
            );
          })}
        </div>
      </div>
    </DashboardCard>
  );
}

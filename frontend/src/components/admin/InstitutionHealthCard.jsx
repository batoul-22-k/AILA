import { Activity, Building2, Info, ShieldCheck, TrendingDown, TrendingUp, Users } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

function statusTone(status = "") {
  if (status === "Critical") return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100";
  if (status === "Attention" || status === "Needs Attention") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100";
}

function TrendValue({ value = 0 }) {
  const normalized = Number(value || 0);
  const Icon = normalized > 0 ? TrendingUp : normalized < 0 ? TrendingDown : Activity;
  const tone = normalized > 0 ? "text-red-600" : normalized < 0 ? "text-emerald-600" : "text-slate-500";
  const label = normalized > 0 ? `+${normalized}` : `${normalized}`;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-black ${tone}`}>
      <Icon size={14} />
      {label} this week
    </span>
  );
}

function InfoTip({ label, text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-role-border hover:bg-role-hover hover:text-role-primary dark:hover:bg-slate-900"
        aria-label={label}
      >
        <Info size={13} />
      </button>
      <span className="pointer-events-none absolute left-0 top-7 z-30 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-slate-500 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {text}
      </span>
    </span>
  );
}

export function InstitutionHealthCard({ health }) {
  const score = Math.round(Number(health?.institution_engagement_health || 0));
  const status = health?.status || "Attention";
  const activeClasses = Number(health?.active_classes || 0);
  const totalClasses = Number(health?.total_classes || activeClasses || 0);
  const activityPercentage = Math.round(Number(health?.active_activity_percentage || 0));

  const cards = [
    {
      title: "Institution Health",
      info: "Institution Health = clamp(0.55 x Avg Engagement + 0.25 x Risk Safety + 0.20 x Instructor Activity). Risk Safety = max(0, 100 - min(Students Needing Support x 5, 100)).",
      value: score,
      suffix: "/100",
      detail: status,
      icon: ShieldCheck,
      tone: status,
      status,
    },
    {
      title: "Students Needing Support",
      value: health?.students_needing_support || 0,
      detail: <TrendValue value={health?.students_needing_support_weekly_trend || 0} />,
      icon: Users,
      tone: "Critical",
    },
    
    {
      title: "Active Classes",
      value: `${activeClasses}/${totalClasses}`,
      detail: `${activityPercentage}% currently active`,
      icon: Building2,
      tone: "Neutral",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((item) => {
        const Icon = item.icon;
        const iconTone = item.tone === "Critical" ? "border-red-200 bg-red-50 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100" : item.tone === "Attention" || item.tone === "Needs Attention" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100" : item.tone === "Healthy" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-sky-200 bg-sky-50 text-role-primary dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100";
        return (
          <DashboardCard key={item.title} className="min-h-[104px] p-4 shadow-none">
            <div className="flex h-full items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{item.title}</p>
                  {item.info && <InfoTip label={`${item.title} calculation`} text={item.info} />}
                </div>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-2xl font-black leading-none text-slate-950 dark:text-white">{item.value}</span>
                  {item.suffix && <span className="pb-1 text-sm font-black text-slate-500">{item.suffix}</span>}
                </div>
                <div className="mt-2">
                  {item.status ? (
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${statusTone(item.status)}`}>{item.detail}</span>
                  ) : (
                    <p className="line-clamp-1 text-xs font-bold text-slate-500 dark:text-slate-400">{item.detail}</p>
                  )}
                </div>
              </div>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${iconTone}`}>
                <Icon size={18} />
              </span>
            </div>
          </DashboardCard>
        );
      })}
    </div>
  );
}

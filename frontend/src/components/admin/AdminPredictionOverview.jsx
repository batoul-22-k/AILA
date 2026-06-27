import { BrainCircuit, CalendarClock } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

function formatDate(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AdminPredictionOverview({ overview }) {
  if (!overview || overview.empty) {
    return (
      <DashboardCard className="p-4 shadow-none">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-role-hover text-role-primary dark:bg-slate-950/40">
            <BrainCircuit size={19} />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Prediction insights</p>
            <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Prediction insights pending</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
              Prediction insights will appear once enough classroom activity has been collected.
            </p>
          </div>
        </div>
      </DashboardCard>
    );
  }

  const stats = [
    { label: "High-risk students", value: overview.high_risk_students_count || 0 },
    { label: "Weak classes", value: overview.weak_classes || 0 },
    { label: "Decline classes", value: overview.engagement_decline_classes || 0 },
    { label: "Confidence", value: `${Math.round(overview.prediction_confidence || 0)}%` },
  ];

  return (
    <DashboardCard className="p-4 shadow-none">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-role-hover text-role-primary dark:bg-slate-950/40">
            <BrainCircuit size={19} />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-primary">Prediction insights</p>
            <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Institution prediction signals</h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-role-hover px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          <CalendarClock size={14} />
          {formatDate(overview.last_prediction_run)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-lg border border-role-border bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] font-black uppercase text-slate-500">{item.label}</p>
            <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-role-border p-3 dark:border-slate-800">
        <p className="text-xs font-black uppercase tracking-wide text-role-primary">Recent prediction alerts</p>
        <div className="mt-2 grid gap-2">
          {(overview.recent_prediction_alerts || []).length === 0 && (
            <p className="rounded-lg bg-role-hover p-3 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">
              No recent prediction alerts.
            </p>
          )}
          {(overview.recent_prediction_alerts || []).slice(0, 4).map((alert) => (
            <div key={`${alert.title}-${alert.class_name}-${alert.generated_at}`} className="rounded-lg bg-role-hover p-2.5 dark:bg-slate-950/40">
              <p className="font-black text-slate-950 dark:text-white">{alert.title}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {alert.class_name || "Class"} · {formatDate(alert.generated_at)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </DashboardCard>
  );
}

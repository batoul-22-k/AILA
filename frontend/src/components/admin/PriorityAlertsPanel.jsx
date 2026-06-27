import { CheckCircle2, Filter, SortDesc } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../Button";
import { DashboardCard } from "../DashboardCard";

const severityFilters = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "attention", label: "Attention" },
];

function severityClass(severity) {
  if (severity === "critical") return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100";
  return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100";
}

function rank(severity) {
  return { critical: 0, warning: 1, attention: 2 }[severity] ?? 3;
}

function formatDate(value) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function PriorityAlertsPanel({ alerts = [], onReview, reviewingId = "" }) {
  const [severity, setSeverity] = useState("all");
  const [newestFirst, setNewestFirst] = useState(true);

  const rows = useMemo(() => {
    return alerts
      .filter((alert) => severity === "all" || alert.severity === severity)
      .sort((a, b) => {
        if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
        if (newestFirst) return new Date(b.created_at || 0) - new Date(a.created_at || 0) || rank(a.severity) - rank(b.severity);
        return rank(a.severity) - rank(b.severity) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  }, [alerts, newestFirst, severity]);

  const activeAlerts = alerts.filter((alert) => !alert.reviewed);

  return (
    <DashboardCard className="p-4 shadow-none">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Priority alerts</p>
          <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Intervention queue</h2>
        </div>
        <span className="w-fit rounded-full bg-role-hover px-3 py-1 text-xs font-black text-role-primary">{activeAlerts.length} active</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Filter size={16} className="text-slate-400" />
        {severityFilters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs font-black transition ${severity === item.key ? "bg-role-primary text-white" : "bg-role-hover text-slate-600 hover:text-role-primary dark:bg-slate-950/40 dark:text-slate-300"}`}
            onClick={() => setSeverity(item.key)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-role-hover px-3 py-1.5 text-xs font-black text-slate-600 transition hover:text-role-primary dark:bg-slate-950/40 dark:text-slate-300"
          onClick={() => setNewestFirst((current) => !current)}
        >
          <SortDesc size={14} />
          {newestFirst ? "Newest" : "Severity"}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-role-border dark:border-slate-800">
        <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
            <tr>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Severity</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Entity</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Reason</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Recommended action</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm font-semibold text-slate-500" colSpan={5}>No priority alerts match this filter.</td>
              </tr>
            )}
            {rows.slice(0, 8).map((alert) => (
              <tr key={alert.alert_id} className={alert.reviewed ? "bg-slate-50/70 dark:bg-slate-950/30" : "bg-white dark:bg-slate-900"}>
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${severityClass(alert.severity)}`}>{alert.severity}</span>
                </td>
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <p className="font-black text-slate-950 dark:text-white">{alert.class_name || alert.affected}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">{formatDate(alert.created_at)}</p>
                </td>
                <td className="border-b border-role-border/80 px-3 py-2.5 font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">{alert.reason}</td>
                <td className="border-b border-role-border/80 px-3 py-2.5 font-semibold text-role-primary dark:border-slate-800">{alert.recommended_action}</td>
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  {alert.reviewed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      <CheckCircle2 size={12} />
                      Reviewed
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" loading={reviewingId === alert.alert_id} onClick={() => onReview?.(alert)}>
                      Review
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

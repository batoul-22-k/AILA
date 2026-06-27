import { BookOpen, CheckCircle2, Clock, MessageSquareWarning } from "lucide-react";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";

function formatDate(value) {
  if (!value) return "No activity";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function instructorStatus(row) {
  if (!row.last_activity) return { label: "Inactive", tone: "slate" };
  if (row.support_signal === "Needs support" || Number(row.pending_short_answer_reviews || 0) >= 10) {
    return { label: "Needs Attention", tone: "gold" };
  }
  return { label: "Active", tone: "green" };
}

export function AdminInstructorMonitoring({ instructors = [], compact = false }) {
  const rows = compact ? instructors.slice(0, 8) : instructors;

  return (
    <DashboardCard className="p-4 shadow-none">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-role-primary">Instructor monitoring</p>
        <h2 className="mt-1 text-base font-black text-slate-950 dark:text-white">Instructor performance support</h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Signals are for support and coordination, not ranking or punishment.</p>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-role-border dark:border-slate-800">
        <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
            <tr>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Instructor Name</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Classes Managed</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Average Engagement</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Sessions Created</th>
              
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Last Activity</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-5 text-sm font-semibold text-slate-500" colSpan={7}>
                  No instructor activity yet.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const status = instructorStatus(row);
              return (
                <tr key={row.instructor_id} className="align-middle bg-white transition hover:bg-role-hover/60 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                  <td className="border-b border-role-border/80 px-3 py-2.5 font-black text-slate-950 dark:border-slate-800 dark:text-white">{row.instructor_name}</td>
                  <MetricCell icon={BookOpen} value={row.classes_managed || 0} />
                  <MetricCell icon={CheckCircle2} value={`${Math.round(row.student_engagement_average || 0)}%`} />
                  <MetricCell icon={Clock} value={row.sessions_created || 0} />
                
                  <td className="border-b border-role-border/80 px-3 py-2.5 font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">{formatDate(row.last_activity)}</td>
                  <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                    <Badge className="px-2 py-0.5" tone={status.tone}>{status.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

function MetricCell({ icon: Icon, value }) {
  return (
    <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
      <span className="inline-flex items-center gap-1.5 font-black text-slate-800 dark:text-white">
        <Icon size={14} className="text-role-primary" />
        {value}
      </span>
    </td>
  );
}

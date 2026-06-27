import { AlertTriangle } from "lucide-react";

import { DashboardCard } from "../DashboardCard";

export function AdminRiskOverview({ riskOverview }) {
  const byClass = riskOverview?.by_class || [];
  const byReason = riskOverview?.by_reason || [];
  const byInstructor = riskOverview?.by_instructor || [];

  return (
    <DashboardCard>
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-role-primary">Risk overview</p>
        <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Grouped support signals</h2>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <div className="rounded-xl bg-role-hover p-4 dark:bg-slate-950/40">
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">By class</p>
          <div className="mt-3 grid gap-2">
            {byClass.slice(0, 5).map((row) => (
              <div key={row.class_id} className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
                <p className="font-black text-slate-950 dark:text-white">{row.summary}</p>
                <p className="mt-1 font-semibold text-slate-500">{row.instructor_name} · {row.trend}</p>
              </div>
            ))}
            {byClass.length === 0 && <EmptyLine text="No grouped class risk signals." />}
          </div>
        </div>
        <MiniList title="By reason" rows={byReason} labelKey="reason" valueKey="count" />
        <MiniList title="By instructor" rows={byInstructor} labelKey="instructor_name" valueKey="risk_count" />
      </div>
    </DashboardCard>
  );
}

function MiniList({ title, rows, labelKey, valueKey }) {
  return (
    <div className="rounded-xl bg-role-hover p-4 dark:bg-slate-950/40">
      <p className="text-xs font-black uppercase tracking-wide text-role-primary">{title}</p>
      <div className="mt-3 grid gap-2">
        {rows.slice(0, 5).map((row) => (
          <div key={row[labelKey]} className="flex items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
            <span className="font-black text-slate-800 dark:text-white">{row[labelKey]}</span>
            <span className="inline-flex items-center gap-1 font-black text-amber-700 dark:text-amber-100">
              <AlertTriangle size={14} />
              {row[valueKey]}
            </span>
          </div>
        ))}
        {rows.length === 0 && <EmptyLine text="No data yet." />}
      </div>
    </div>
  );
}

function EmptyLine({ text }) {
  return <p className="rounded-lg bg-white p-3 text-sm font-semibold text-slate-500 dark:bg-slate-900">{text}</p>;
}

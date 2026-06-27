import { Activity, Eye, Filter, Info, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "../Badge";
import { DashboardCard } from "../DashboardCard";

const filters = [
  { key: "all", label: "All" },
  { key: "healthy", label: "Healthy" },
  { key: "attention", label: "Attention" },
  { key: "critical", label: "Critical" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

function trendIcon(trend) {
  if (trend === "declining") return <TrendingDown size={16} className="text-red-500" />;
  if (trend === "improving") return <TrendingUp size={16} className="text-emerald-500" />;
  return <Activity size={16} className="text-role-primary" />;
}

function statusTone(status) {
  if (status === "Critical") return "red";
  if (status === "Attention") return "gold";
  return "green";
}

function matches(row, filter) {
  const status = String(row.status || "active").toLowerCase();
  const health = String(row.health_status || "").toLowerCase();
  if (filter === "active") return !["inactive", "archived"].includes(status);
  if (filter === "inactive") return ["inactive", "archived"].includes(status);
  if (filter === "healthy") return health === "healthy";
  if (filter === "attention") return health === "attention";
  if (filter === "critical") return health === "critical";
  return true;
}

function formatDate(value) {
  if (!value) return "No activity";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function percent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function InfoTip({ label, text }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="focus-ring inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-role-border hover:bg-white hover:text-role-primary dark:hover:bg-slate-900"
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

function HeaderWithInfo({ children, label, text }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <InfoTip label={label} text={text} />
    </span>
  );
}

export function AdminClassMonitoring({ classes = [], compact = false }) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => classes.filter((row) => matches(row, filter)), [classes, filter]);
  const visibleRows = compact ? rows.slice(0, 8) : rows;

  return (
    <DashboardCard className="p-4 shadow-none">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-role-primary">Class health overview</p>
                  </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-black transition ${filter === item.key ? "bg-role-primary text-white" : "bg-role-hover text-slate-600 hover:text-role-primary dark:bg-slate-950/40 dark:text-slate-300"}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-role-border dark:border-slate-800">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-role-hover text-[11px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950">
            <tr>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Class</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Instructor</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">
                <HeaderWithInfo
                  label="Class health calculation"
                  text="Class Health = clamp(0.40 x Engagement + 0.30 x Attendance + 0.20 x Participation + 10 - Risk Penalty - Bloom Cognitive Skill Penalty - Inactivity Penalty). Risk = min(At-risk x 5, 25); Bloom = min(Bloom levels requiring improvement x 3, 15); Inactive = 12 after 14+ days."
                >
                  Health
                </HeaderWithInfo>
              </th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">
                <HeaderWithInfo
                  label="Engagement calculation"
                  text="Engagement = 0.35 x Attendance + 0.25 x Participation + 0.25 x Correctness + 0.10 x Response Consistency + 0.05 x Recent Activity."
                >
                  Engagement
                </HeaderWithInfo>
              </th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">At-risk</th>
{/*               <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Bloom levels requiring improvement</th>
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Trend</th> */}
              <th className="border-b border-role-border px-3 py-2.5 dark:border-slate-800">Last activity</th>
          
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td className="px-3 py-5 text-sm font-semibold text-slate-500" colSpan={9}>
                  No classes match this filter.
                </td>
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr key={row.class_id} className="align-middle bg-white transition hover:bg-role-hover/60 dark:bg-slate-900 dark:hover:bg-slate-800/50">
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <p className="font-black text-slate-950 dark:text-white">{row.class_name}</p>
                  <Badge className="mt-1 px-2 py-0.5" tone={String(row.status).toLowerCase() === "inactive" ? "slate" : "green"}>
                    {String(row.status || "Active").toLowerCase() === "inactive" ? "Inactive" : "Active"}
                  </Badge>
                </td>
                <td className="border-b border-role-border/80 px-3 py-2.5 font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  {(row.instructor_names || []).join(", ") || "Unassigned"}
                </td>
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-slate-950 dark:text-white">{Math.round(row.health_score || 0)}</span>
                    <Badge className="px-2 py-0.5" tone={statusTone(row.health_status)}>{row.health_status || "Attention"}</Badge>
                  </div>
                </td>
                <td className="border-b border-role-border/80 px-3 py-2.5 font-black text-slate-800 dark:border-slate-800 dark:text-white">{percent(row.engagement_score)}</td>
                <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <Badge className="px-2 py-0.5" tone={row.risk_count > 0 ? "red" : "green"}>{row.risk_count || 0}</Badge>
                </td>
                
                <td className="border-b border-role-border/80 px-3 py-2.5 font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">{formatDate(row.last_activity)}</td>
                {/* <td className="border-b border-role-border/80 px-3 py-2.5 dark:border-slate-800">
                  <div className="flex flex-wrap gap-2">
                    <ActionLink to={`/admin/classes?class=${row.class_id}`} icon={Eye} label="View" />
                  </div>
                </td> */}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  );
}

function ActionLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border border-role-border bg-white px-3 text-xs font-black text-slate-600 transition hover:border-role-primary hover:text-role-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
    >
      <Icon size={14} />
      {label}
    </Link>
  );
}

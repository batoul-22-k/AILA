import { Activity, AlertTriangle, BarChart3, Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAdminDashboard } from "../../api/client";
import { Badge } from "../../components/Badge";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { RiskBadge } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { activityLogs, engagementTrend, riskReports } from "../../data/mockData";

export function AdminDashboardPage() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    getAdminDashboard().then(setSummary).catch(() => setSummary(null));
  }, []);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Administrator dashboard" title="Institution engagement overview" description="Executive KPIs, trend lines, and risk signals for smart class operations." tone="role" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active sessions" value={summary?.active_sessions ?? 0} icon={Activity} tone="role" trend="+9%" />
        <StatCard label="Classes" value={summary?.total_classes ?? 0} icon={Building2} tone="role" />
        <StatCard label="Responses" value={summary?.total_responses ?? 0} icon={BarChart3} tone="gold" trend="+18%" />
        <StatCard label="Risk alerts" value="2" icon={AlertTriangle} tone="red" detail="needs review" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_0.75fr]">
        <ChartCard title="Engagement trend" subtitle="Executive trend across all classes">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={engagementTrend}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip />
              <Area type="monotone" dataKey="engagement" stroke="#0d8587" strokeWidth={3} fill="#16a3a333" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <DashboardCard>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Risk indicators</h2>
          <div className="mt-4 grid gap-3">
            {riskReports.map((report) => (
              <div key={report.title} className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-800 dark:text-slate-100">{report.title}</p>
                  <RiskBadge level={report.level} />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{report.detail}</p>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>
      <DashboardCard>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Recent institution activity</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {activityLogs.map((log) => (
            <div key={`${log.user}-${log.details}`} className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <Badge tone={log.category === "risk" ? "red" : log.category === "report" ? "orange" : "violet"}>{log.category}</Badge>
              <p className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">{log.user}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{log.details}</p>
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

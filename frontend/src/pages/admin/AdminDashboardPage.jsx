import { Activity, AlertTriangle, BarChart3, Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAdminDashboard, getClassAnalytics, listClasses } from "../../api/client";
import { Badge } from "../../components/Badge";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { RiskBadge } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { aggregateWeeklyAverages, classAnalyticsRows, latestAverageSummary, riskReason } from "../../utils/analytics";

export function AdminDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [classes, setClasses] = useState([]);
  const [summaries, setSummaries] = useState([]);

  const classRows = classAnalyticsRows(classes, summaries).map((row) => ({ ...row, reason: riskReason(row) }));
  const weeklyTrend = aggregateWeeklyAverages(summaries);
  const averages = latestAverageSummary(summaries);
  const riskRows = classRows.filter((row) => row.risk !== "Low").sort((first, second) => first.engagement - second.engagement).slice(0, 4);
  const activityRows = classRows
    .filter((row) => row.week !== "No data")
    .sort((first, second) => first.engagement - second.engagement)
    .slice(0, 6);
  const highRiskCount = classRows.filter((row) => row.risk === "High").length;
  const mediumRiskCount = classRows.filter((row) => row.risk === "Medium").length;

  useEffect(() => {
    getAdminDashboard().then(setSummary).catch(() => setSummary(null));
    async function loadAnalytics() {
      const classResult = await listClasses({ includeInactive: true }).catch(() => []);
      const summaryResult = await Promise.all(classResult.map((classDoc) => getClassAnalytics(classDoc.class_id).catch(() => ({ class_id: classDoc.class_id }))));
      setClasses(classResult);
      setSummaries(summaryResult);
    }
    loadAnalytics();
  }, []);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Administrator dashboard" title="Institution engagement overview" description="Executive KPIs, trend lines, and risk signals for smart class operations." tone="role" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active sessions"
          value={summary?.active_sessions ?? 0}
          icon={Activity}
          tone="role"
          detailPanel={{
            title: "Session details",
            description: "Live sessions currently active across the institution.",
            items: [
              { label: "Active sessions", value: summary?.active_sessions ?? 0 },
              { label: "Tracked classes", value: summary?.total_classes ?? classes.length },
            ],
          }}
        />
        <StatCard
          label="Classes"
          value={summary?.total_classes ?? 0}
          icon={Building2}
          tone="role"
          detailPanel={{
            title: "Class details",
            description: "Classes included in the institution dashboard.",
            items: [
              { label: "Dashboard total", value: summary?.total_classes ?? 0 },
              { label: "Loaded records", value: classes.length },
              { label: "With analytics", value: summaries.filter((item) => item.week).length },
            ],
          }}
        />
        <StatCard
          label="Responses"
          value={summary?.total_responses ?? 0}
          icon={BarChart3}
          tone="gold"
          detail={`${averages.participation}% participation`}
          detailPanel={{
            title: "Response details",
            description: "Submitted live-class answers and current participation average.",
            items: [
              { label: "Total responses", value: summary?.total_responses ?? 0 },
              { label: "Avg participation", value: `${averages.participation}%` },
              { label: "Avg attendance", value: `${averages.attendance}%` },
            ],
          }}
        />
        <StatCard
          label="Risk alerts"
          value={riskRows.length}
          icon={AlertTriangle}
          tone="red"
          detail={`${averages.engagement}% avg engagement`}
          detailPanel={{
            title: "Risk details",
            description: "Classes below engagement or participation expectations.",
            items: [
              { label: "High risk", value: highRiskCount },
              { label: "Medium risk", value: mediumRiskCount },
              { label: "Avg engagement", value: `${averages.engagement}%` },
            ],
          }}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_0.75fr]">
        <ChartCard title="Engagement trend" subtitle="Executive trend across all classes">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyTrend}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Area type="monotone" dataKey="engagement" stroke="#0d8587" strokeWidth={3} fill="#16a3a333" />
              <Area type="monotone" dataKey="attendance" stroke="#245866" strokeWidth={3} fill="#24586622" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <DashboardCard>
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Risk indicators</h2>
          <div className="mt-4 grid gap-3">
            {riskRows.length === 0 && (
              <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
                No analytics risk indicators yet. Recalculate class analytics after live sessions have responses.
              </div>
            )}
            {riskRows.map((report) => (
              <div key={report.class_id} className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-800 dark:text-slate-100">{report.className}</p>
                  <RiskBadge level={report.risk} />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {report.reason}: {report.engagement}% engagement, {report.participation}% participation.
                </p>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>
      <DashboardCard>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Recent institution activity</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {activityRows.length === 0 && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
              No weekly analytics results yet.
            </div>
          )}
          {activityRows.map((row) => (
            <div key={row.class_id} className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
              <Badge tone={row.risk === "High" ? "red" : row.risk === "Medium" ? "gold" : "green"}>{row.week}</Badge>
              <p className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">{row.className}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {row.engagement}% engagement with {row.activeStudents}/{row.totalStudents} active students.
              </p>
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

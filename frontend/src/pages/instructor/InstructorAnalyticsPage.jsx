import { Activity, BarChart3, Radio, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getClassAnalytics, listClasses, recalculateClassAnalytics } from "../../api/client";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable, RiskBadge } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { aggregateWeeklyAverages, classAnalyticsRows, formatPercent, latestAverageSummary, riskReason } from "../../utils/analytics";

export function InstructorAnalyticsPage() {
  const [classes, setClasses] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const classRows = classAnalyticsRows(classes, summaries).map((row) => ({ ...row, reason: riskReason(row) }));
  const weeklyTrend = aggregateWeeklyAverages(summaries);
  const averages = latestAverageSummary(summaries);
  const atRiskCount = classRows.filter((row) => row.risk !== "Low").length;

  async function loadAnalytics() {
    const classResult = await listClasses().catch(() => []);
    const summaryResult = await Promise.all(classResult.map((classDoc) => getClassAnalytics(classDoc.class_id).catch(() => ({ class_id: classDoc.class_id }))));
    setClasses(classResult);
    setSummaries(summaryResult);
  }

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function handleRecalculate() {
    setRefreshing(true);
    try {
      await Promise.all(classes.map((classDoc) => recalculateClassAnalytics(classDoc.class_id).catch(() => null)));
      await loadAnalytics();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Analytics"
        title="Classroom insight dashboard"
        description="Attendance, participation, consistency, and engagement scores calculated from live sessions."
        tone="role"
        action={
          <Button type="button" variant="role" loading={refreshing} onClick={handleRecalculate}>
            <RefreshCw size={18} />
            Recalculate
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Avg attendance"
          value={formatPercent(averages.attendance)}
          icon={Activity}
          tone="role"
          detailPanel={{
            title: "Attendance details",
            description: "Average attendance across selected class analytics.",
            items: [
              { label: "Avg attendance", value: formatPercent(averages.attendance) },
              { label: "Classes measured", value: summaries.filter((item) => item.week).length },
            ],
          }}
        />
        <StatCard
          label="Avg participation"
          value={formatPercent(averages.participation)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation details",
            description: "Average question response rate from live sessions.",
            items: [
              { label: "Avg participation", value: formatPercent(averages.participation) },
              { label: "At-risk classes", value: atRiskCount },
            ],
          }}
        />
        <StatCard
          label="Avg engagement"
          value={formatPercent(averages.engagement)}
          icon={BarChart3}
          tone="role"
          detailPanel={{
            title: "Engagement details",
            description: "Combined class score from attendance and participation behavior.",
            items: [
              { label: "Avg engagement", value: formatPercent(averages.engagement) },
              { label: "Avg attendance", value: formatPercent(averages.attendance) },
              { label: "Avg participation", value: formatPercent(averages.participation) },
            ],
          }}
        />
        <StatCard
          label="Active students"
          value={averages.activeStudents}
          icon={Users}
          tone="role"
          detail={`${averages.totalStudents} enrolled`}
          detailPanel={{
            title: "Student details",
            description: "Active students compared with total enrollment.",
            items: [
              { label: "Active students", value: averages.activeStudents },
              { label: "Enrolled students", value: averages.totalStudents },
              { label: "Classes", value: classes.length },
            ],
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Weekly engagement" subtitle="Averages across your active classes">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyTrend}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="engagement" stroke="#16a3a3" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="participation" stroke="#8067dc" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Class metric breakdown" subtitle={`${atRiskCount} class${atRiskCount === 1 ? "" : "es"} need support`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={classRows}>
              <XAxis dataKey="className" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="attendance" fill="#2B7886" radius={[10, 10, 0, 0]} />
              <Bar dataKey="participation" fill="#79D99C" radius={[10, 10, 0, 0]} />
              <Bar dataKey="engagement" fill="#245866" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <ResponsiveTable
        columns={[
          { key: "className", label: "Class" },
          { key: "week", label: "Week" },
          { key: "attendance", label: "Attendance", render: (row) => `${row.attendance}%` },
          { key: "participation", label: "Participation", render: (row) => `${row.participation}%` },
          { key: "engagement", label: "Engagement", render: (row) => `${row.engagement}%` },
          { key: "risk", label: "Risk", render: (row) => <RiskBadge level={row.risk} /> },
          { key: "reason", label: "Reason" },
        ]}
        rows={classRows}
      />
    </div>
  );
}

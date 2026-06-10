import { Activity, BrainCircuit, BookOpen, Radio, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getAtRiskStudents, getClassAnalytics, getInstructorDashboard, listClasses, recalculateClassAnalytics } from "../../api/client";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";
import { aggregateWeeklyAverages, classAnalyticsRows, formatPercent, latestAverageSummary } from "../../utils/analytics";

export function InstructorDashboardPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const [summary, setSummary] = useState(null);
  const [classes, setClasses] = useState([]);
  const [analyticsSummaries, setAnalyticsSummaries] = useState([]);
  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);

  const activeClassId = currentWorkspace?.type === "instructor" ? currentWorkspace.class_id : classes[0]?.class_id;
  const activeSummary = analyticsSummaries.find((item) => item.class_id === activeClassId) || analyticsSummaries[0] || {};
  const classRows = classAnalyticsRows(classes, analyticsSummaries);
  const atRiskCount = atRiskStudents.length;
  const weeklyTrend = activeSummary.weekly_averages?.length
    ? activeSummary.weekly_averages.map((point) => ({
        week: point.week,
        attendance: Math.round(point.average_attendance_rate || 0),
        participation: Math.round(point.average_participation_rate || 0),
        engagement: Math.round(point.average_engagement_score || 0),
      }))
    : aggregateWeeklyAverages(analyticsSummaries);
  const classComparison = classRows.map((row) => ({ className: row.className, engagement: row.engagement, participation: row.participation }));
  const averages = latestAverageSummary(analyticsSummaries);

  async function loadDashboard() {
    const dashboardSummary = await getInstructorDashboard().catch(() => null);
    const classResult = await listClasses().catch(() => []);
    const analyticsResult = await Promise.all(classResult.map((classDoc) => getClassAnalytics(classDoc.class_id).catch(() => ({ class_id: classDoc.class_id }))));
    const atRiskResult = await getAtRiskStudents().catch(() => []);
    setSummary(dashboardSummary);
    setClasses(classResult);
    setAnalyticsSummaries(analyticsResult);
    setAtRiskStudents(atRiskResult.filter((student) => classResult.some((classDoc) => classDoc.class_id === student.class_id)));
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleRefreshAnalytics() {
    setRefreshingAnalytics(true);
    try {
      await Promise.all(classes.map((classDoc) => recalculateClassAnalytics(classDoc.class_id).catch(() => null)));
      await loadDashboard();
    } finally {
      setRefreshingAnalytics(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        /* eyebrow="Instructor dashboard" */
        tone="role"
        action={
          <Link to="/instructor/sessions">
            <Button size="lg" variant="role">
              <Radio size={18} />
              Create session
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active sessions"
          value={summary?.active_sessions ?? 0}
          icon={Activity}
          tone="role"
          detailPanel={{
            title: "Session details",
            description: "Instructor sessions currently open for live class activity.",
            items: [
              { label: "Active sessions", value: summary?.active_sessions ?? 0 },
              { label: "Classes loaded", value: classes.length },
            ],
          }}
        />
        <StatCard
          label="Classes"
          value={summary?.total_classes ?? 0}
          icon={Users}
          tone="role"
          detailPanel={{
            title: "Class details",
            description: "Teaching workspaces included in this dashboard.",
            items: [
              { label: "Dashboard total", value: summary?.total_classes ?? 0 },
              { label: "Loaded classes", value: classes.length },
              { label: "With analytics", value: analyticsSummaries.filter((item) => item.week).length },
            ],
          }}
        />
        <StatCard
          label="Participation"
          value={formatPercent(averages.participation)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation details",
            description: "Average student response rate across active classes.",
            items: [
              { label: "Avg participation", value: formatPercent(averages.participation) },
              { label: "Avg attendance", value: formatPercent(averages.attendance) },
              { label: "Avg engagement", value: formatPercent(averages.engagement) },
            ],
          }}
        />
        <Link className="focus-ring rounded-[var(--role-radius)]" to="/instructor/at-risk">
          <StatCard
            label="At-Risk Students"
            value={atRiskCount}
            icon={BrainCircuit}
            tone="red"
            detail={`${formatPercent(averages.engagement)} avg engagement`}
            detailPanel={{
              title: "Risk details",
              description: "Students flagged for follow-up from engagement analytics.",
              items: [
                { label: "At-risk students", value: atRiskCount },
                { label: "Avg engagement", value: formatPercent(averages.engagement) },
                { label: "Classes reviewed", value: classes.length },
              ],
            }}
          />
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <ChartCard title="Weekly engagement trend" subtitle={activeSummary.class_id ? "Selected class weekly averages" : "All class weekly averages"}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyTrend}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Area type="monotone" dataKey="engagement" stroke="#2B7886" strokeWidth={3} fill="#2B788626" />
              <Area type="monotone" dataKey="participation" stroke="#79D99C" strokeWidth={3} fill="#79D99C33" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Class engagement" subtitle="Latest class averages from analytics results">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={classComparison} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" axisLine={false} tickLine={false} domain={[0, 100]} />
              <YAxis type="category" dataKey="className" axisLine={false} tickLine={false} width={110} />
              <Tooltip />
              <Bar dataKey="engagement" fill="#2B7886" radius={[0, 12, 12, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Operational workflow</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create sessions, then refresh analytics to reflect attendance and responses from live class activity.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" loading={refreshingAnalytics} onClick={handleRefreshAnalytics}>
              <RefreshCw size={17} />
              Refresh analytics
            </Button>
            <Link to="/instructor/classes">
              <Button variant="outline">
                <BookOpen size={17} />
                Classes
              </Button>
            </Link>
            <Link to="/instructor/content-studio">
              <Button variant="role">
                <BrainCircuit size={17} />
                Content Studio
              </Button>
            </Link>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
}

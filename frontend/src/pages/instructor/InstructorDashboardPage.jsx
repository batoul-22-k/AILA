import { Activity, BookOpen, Plus, Radio, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getClassAnalytics, getClassPredictionSummary, getInstructorDashboard, listClasses, recalculateClassAnalytics } from "../../api/client";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { CardSkeleton, ChartSkeleton } from "../../components/LoadingSkeleton";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { aggregateEngagementTrend, classAnalyticsRows, formatPercent, latestAverageSummary } from "../../utils/analytics";

const TREND_PERIODS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export function InstructorDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [classes, setClasses] = useState([]);
  const [analyticsSummaries, setAnalyticsSummaries] = useState([]);
  const [atRiskStudents, setAtRiskStudents] = useState([]);
  const [trendPeriod, setTrendPeriod] = useState("week");
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);

  const classRows = classAnalyticsRows(classes, analyticsSummaries);
  const atRiskCount = atRiskStudents.length;
  const engagementTrend = aggregateEngagementTrend(analyticsSummaries, trendPeriod);
  const measuredClassCount = analyticsSummaries.filter((item) => item.week).length;
  const trendMessage = measuredClassCount === 0
    ? "No engagement analytics have been calculated yet."
    : `Need at least two ${trendPeriod} periods to draw a trend.`;
  const classComparison = classRows.map((row) => ({ className: row.className, engagement: row.engagement, participation: row.participation }));
  const averages = latestAverageSummary(analyticsSummaries);

  async function loadDashboard() {
    setLoadingDashboard(true);
    const dashboardSummary = await getInstructorDashboard().catch(() => null);
    const classResult = await listClasses().catch(() => []);
    const analyticsResult = await Promise.all(classResult.map((classDoc) => getClassAnalytics(classDoc.class_id).catch(() => ({ class_id: classDoc.class_id }))));
    const predictionSummaries = await Promise.all(classResult.map((classDoc) => getClassPredictionSummary(classDoc.class_id).catch(() => ({ at_risk_students: [] }))));
    setSummary(dashboardSummary);
    setClasses(classResult);
    setAnalyticsSummaries(analyticsResult);
    setAtRiskStudents(predictionSummaries.flatMap((row) => row.at_risk_students || []));
    setLoadingDashboard(false);
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
        title="Dashboard"
        tone="role"
        action={
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Link to="/instructor/sessions">
              <Button variant="role" size="lg" className="rounded-full px-4">
                <Plus size={17} />
            
              </Button>
            </Link>
            <Button type="button" variant="outline" size="lg" className="rounded-full px-4" loading={refreshingAnalytics} onClick={handleRefreshAnalytics}>
              <RefreshCw size={17} />
              
            </Button>
            <Link to="/instructor/classes">
              <Button variant="outline" size="lg" className="rounded-full px-4">
                <BookOpen size={17} />
                
              </Button>
            </Link>
            <Link to="/instructor/content-studio">
              <Button variant="role" size="lg" className="rounded-full px-4">
                <Radio size={17} />
                Content Studio
              </Button>
            </Link>
          </div>
        }
      />

      {loadingDashboard ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        </>
      ) : (
      <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Running sessions"
          value={summary?.active_sessions ?? 0}
          icon={Activity}
          tone="role"
          detailPanel={{
            title: "Sessions",
            items: [
              { label: "Running", value: summary?.active_sessions ?? 0 },
              { label: "Classes", value: classes.length },
            ],
          }}
        />
        <StatCard
          label="Classes"
          value={summary?.total_classes ?? 0}
          icon={Users}
          tone="role"
          detailPanel={{
            title: "Classes",
            items: [
              { label: "Total", value: summary?.total_classes ?? 0 },
              { label: "Measured", value: measuredClassCount },
            ],
          }}
        />
        <StatCard
          label="Participation"
          value={formatPercent(averages.participation)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation",
            items: [
              { label: "Participation", value: formatPercent(averages.participation) },
              { label: "Attendance", value: formatPercent(averages.attendance) },
              { label: "Engagement", value: formatPercent(averages.engagement) },
            ],
          }}
        />
        <Link className="focus-ring rounded-[var(--role-radius)]" to="/instructor/at-risk">
          <StatCard
            label="At Risk"
            value={atRiskCount}
            icon={Activity}
            tone="red"
            detailPanel={{
              title: "At Risk",
              items: [
                { label: "Students", value: atRiskCount },
                { label: "Engagement", value: formatPercent(averages.engagement) },
              ],
            }}
          />
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <ChartCard
          title="Engagement Trend"
          action={
            <div className="inline-flex rounded-lg border border-role-border bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
              {TREND_PERIODS.map((period) => {
                const active = trendPeriod === period.id;
                return (
                  <button
                    key={period.id}
                    type="button"
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? "bg-role-primary text-white shadow-sm"
                        : "text-slate-500 hover:bg-role-hover hover:text-role-primary dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                    onClick={() => setTrendPeriod(period.id)}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>
          }
        >
          {engagementTrend.length < 2 ? (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
              {trendMessage}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={engagementTrend}>
                <XAxis dataKey="label" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip />
                <Area type="monotone" dataKey="engagement" stroke="#2F7F8A" strokeWidth={3} fill="#2F7F8A22" animationDuration={350} />
                <Area type="monotone" dataKey="participation" stroke="#72B7A2" strokeWidth={3} fill="#72B7A226" animationDuration={350} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Classes">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={classComparison} layout="vertical" margin={{ left: 16 }}>
              <XAxis type="number" axisLine={false} tickLine={false} domain={[0, 100]} />
              <YAxis type="category" dataKey="className" axisLine={false} tickLine={false} width={110} />
              <Tooltip />
              <Bar dataKey="engagement" fill="#2F7F8A" radius={[0, 10, 10, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      </>
      )}

    </div>
  );
}

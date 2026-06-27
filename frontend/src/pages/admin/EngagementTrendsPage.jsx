import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useState } from "react";

import { getAdminTrends, getClassAnalytics, listClasses } from "../../api/client";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { classAnalyticsRows } from "../../utils/analytics";

function colorFor(value) {
  if (value >= 80) return "bg-emerald-500";
  if (value >= 65) return "bg-amber-400";
  return "bg-coral";
}

export function EngagementTrendsPage() {
  const [classes, setClasses] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const classRows = classAnalyticsRows(classes, summaries);
  const heatmapRows = classRows.map((row) => {
    const summary = summaries.find((item) => item.class_id === row.class_id);
    const values = (summary?.weekly_averages || []).slice(-4).map((point) => Math.round(point.average_engagement_score || 0));
    while (values.length < 4) values.unshift(0);
    return [row.className, ...values];
  });

  useEffect(() => {
    async function loadAnalytics() {
      const [trendResult, classResult] = await Promise.all([
        getAdminTrends().catch(() => ({ trends: [] })),
        listClasses({ includeInactive: true }).catch(() => []),
      ]);
      const summaryResult = await Promise.all(classResult.map((classDoc) => getClassAnalytics(classDoc.class_id).catch(() => ({ class_id: classDoc.class_id }))));
      setWeeklyTrend(trendResult.trends || []);
      setClasses(classResult);
      setSummaries(summaryResult);
    }
    loadAnalytics();
  }, []);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Trends" title="Engagement trends and heatmap" description="See how engagement changes by week and class." tone="orange" />
      <ChartCard title="Institution trend" subtitle="Engagement and response volume">
        {weeklyTrend.length === 0 ? (
          <div className="grid h-full min-h-[260px] place-items-center rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
            No weekly engagement trend has been calculated yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyTrend}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="engagement" stroke="#16a3a3" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="participation" stroke="#8067dc" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="attendance" stroke="#2B7886" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <DashboardCard>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Engagement heatmap</h2>
        <div className="mt-4 grid gap-3">
          {heatmapRows.length === 0 && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-300">
              No class analytics results yet.
            </div>
          )}
          {heatmapRows.map(([name, ...values]) => (
            <div key={name} className="grid grid-cols-[110px_1fr] items-center gap-3">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">{name}</span>
              <div className="grid grid-cols-4 gap-2">
                {values.map((value, index) => (
                  <div key={`${name}-${index}`} className={`${colorFor(value)} rounded-lg px-2 py-3 text-center text-xs font-black text-white`}>
                    {value}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

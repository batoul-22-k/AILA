import { Activity, BarChart3, CheckCircle2, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMyProgress, getStudentAnalytics } from "../../api/client";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function missedCount(total, done) {
  return Math.max(Number(total || 0) - Number(done || 0), 0);
}

export function PersonalProgressPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const [analytics, setAnalytics] = useState([]);
  const [progress, setProgress] = useState(null);
  const classAnalytics = currentWorkspace?.class_id ? analytics.filter((row) => row.class_id === currentWorkspace.class_id) : analytics;
  const latest = progress || classAnalytics[0] || null;
  const chartData = useMemo(
    () =>
      (progress?.weekly_trend?.length ? progress.weekly_trend : [...classAnalytics].reverse()).map((row) => ({
        week: row.week,
        attendance: row.attendance_rate,
        participation: row.participation_rate,
        consistency: row.consistency_rate,
        engagement: row.engagement_score,
      })),
    [classAnalytics, progress?.weekly_trend],
  );
  const totalSessions = latest?.total_sessions ?? 0;
  const attendedSessions = latest?.sessions_attended ?? 0;
  const questionsPresented = latest?.questions_presented ?? 0;
  const questionsAnswered = latest?.questions_answered ?? 0;
  const sessionsWithAnswers = latest?.sessions_with_answers ?? 0;

  useEffect(() => {
    if (!user?.user_id) return;
    getStudentAnalytics(user.user_id).then(setAnalytics).catch(() => setAnalytics([]));
    getMyProgress(currentWorkspace?.class_id ? { class_id: currentWorkspace.class_id } : {}).then(setProgress).catch(() => setProgress(null));
  }, [currentWorkspace?.class_id, user?.user_id]);

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Student analytics"
        title="Learning engagement overview"
        description="Weekly attendance, participation, consistency, and engagement scores calculated from live classroom activity."
        tone="role"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="My Attendance"
          value={formatPercent(latest?.attendance_rate)}
          icon={Activity}
          tone="role"
          detail={latest?.risk_level ?? "No data"}
          detailPanel={{
            title: "Attendance details",
            description: "Sessions joined compared with sessions available.",
            items: [
              { label: "Sessions attended", value: formatCount(attendedSessions) },
              { label: "Sessions missed", value: formatCount(missedCount(totalSessions, attendedSessions)) },
              { label: "Total sessions", value: formatCount(totalSessions) },
            ],
          }}
        />
        <StatCard
          label="My Participation"
          value={formatPercent(latest?.participation_rate)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation details",
            description: "Questions answered during live sessions.",
            items: [
              { label: "Questions answered", value: formatCount(questionsAnswered) },
              { label: "Not answered", value: formatCount(missedCount(questionsPresented, questionsAnswered)) },
              { label: "Questions presented", value: formatCount(questionsPresented) },
            ],
          }}
        />
        <StatCard
          label="Consistency"
          value={formatPercent(latest?.consistency_rate)}
          icon={CheckCircle2}
          tone="role"
          detailPanel={{
            title: "Consistency details",
            description: "Attended sessions where at least one answer was submitted.",
            items: [
              { label: "Sessions with answers", value: formatCount(sessionsWithAnswers) },
              { label: "Attended without answers", value: formatCount(missedCount(attendedSessions, sessionsWithAnswers)) },
              { label: "Attended sessions", value: formatCount(attendedSessions) },
            ],
          }}
        />
        <StatCard
          label="My Engagement"
          value={formatPercent(latest?.engagement_score)}
          icon={BarChart3}
          tone="role"
          detailPanel={{
            title: "Engagement details",
            description: "Combined score from attendance, participation, and consistency.",
            items: [
              { label: "Attendance", value: formatPercent(latest?.attendance_rate) },
              { label: "Participation", value: formatPercent(latest?.participation_rate) },
              { label: "Consistency", value: formatPercent(latest?.consistency_rate) },
            ],
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <ChartCard title="Engagement score" subtitle="Weekly weighted score across attendance, participation, and consistency">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="engagement" stroke="#2B7886" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Metric breakdown" subtitle="Latest weekly learning activity">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                { metric: "Attendance", score: latest?.attendance_rate ?? 0 },
                { metric: "Participation", score: latest?.participation_rate ?? 0 },
                { metric: "Consistency", score: latest?.consistency_rate ?? 0 },
              ]}
            >
              <XAxis dataKey="metric" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="score" fill="#2B7886" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <DashboardCard>
        <h2 className="text-lg font-black text-slate-950 dark:text-white">Analytics notes</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="font-black text-slate-800 dark:text-slate-100">Attendance rate</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Sessions attended divided by total class sessions.</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="font-black text-slate-800 dark:text-slate-100">Participation rate</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Answered questions divided by questions presented.</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="font-black text-slate-800 dark:text-slate-100">Consistency rate</p>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Attended sessions where at least one answer was submitted.</p>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
}

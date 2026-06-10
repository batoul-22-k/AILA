import { Activity, ArrowRight, BarChart3, BookOpen, Radio, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMyProgress, getStudentAnalytics } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ChartCard } from "../../components/ChartCard";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function formatActivity(value) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function missedCount(total, done) {
  return Math.max(Number(total || 0) - Number(done || 0), 0);
}

function readActiveSession() {
  try {
    return JSON.parse(localStorage.getItem("activeSession") || "null");
  } catch {
    return null;
  }
}

export function StudentDashboardPage() {
  const { user, workspaces, refreshSession } = useAuth();
  const { currentWorkspace, selectWorkspace } = useCurrentWorkspace();
  const [analytics, setAnalytics] = useState([]);
  const [progress, setProgress] = useState(null);
  const studentClasses = workspaces.filter((workspace) => workspace.type === "student");
  const activeClass = currentWorkspace?.type === "student" ? currentWorkspace : studentClasses[0];
  const activeSession = useMemo(readActiveSession, []);
  const classAnalytics = activeClass?.class_id ? analytics.filter((row) => row.class_id === activeClass.class_id) : analytics;
  const latestAnalytics = progress || classAnalytics[0] || null;
  const progressTrend = progress?.weekly_trend?.length ? progress.weekly_trend : [...classAnalytics].reverse();
  const chartData = progressTrend.map((row) => ({
    week: row.week,
    attendance: row.attendance_rate,
    participation: row.participation_rate,
    engagement: row.engagement_score,
  }));
  const totalSessions = latestAnalytics?.total_sessions ?? 0;
  const attendedSessions = latestAnalytics?.sessions_attended ?? 0;
  const questionsPresented = latestAnalytics?.questions_presented ?? 0;
  const questionsAnswered = latestAnalytics?.questions_answered ?? 0;

  useEffect(() => {
    if (!user?.user_id) return;
    getStudentAnalytics(user.user_id).then(setAnalytics).catch(() => setAnalytics([]));
    getMyProgress(activeClass?.class_id ? { class_id: activeClass.class_id } : {}).then(setProgress).catch(() => setProgress(null));
  }, [activeClass?.class_id, user?.user_id]);

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Student dashboard"
        title={activeClass?.class_name ?? "Student workspace"}
        description="Class access, live session activity, and weekly learning analytics in one workspace."
        tone="role"
        action={
          <Link to="/student/join">
            <Button size="lg" variant="role">
              <Radio size={18} />
              Join session
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Enrolled classes"
          value={studentClasses.length}
          icon={Users}
          tone="role"
          detailPanel={{
            title: "Class details",
            description: "Classes available in your student workspace.",
            items: [
              { label: "Enrolled classes", value: studentClasses.length },
              { label: "Active class", value: activeClass?.class_name || "None selected" },
            ],
          }}
        />
        <StatCard
          label="My Attendance"
          value={formatPercent(latestAnalytics?.attendance_rate)}
          icon={Activity}
          tone="role"
          detail={latestAnalytics?.week ?? latestAnalytics?.risk_level ?? "No data"}
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
          value={formatPercent(latestAnalytics?.participation_rate)}
          icon={Radio}
          tone="gold"
          detailPanel={{
            title: "Participation details",
            description: "Live questions answered in your current class context.",
            items: [
              { label: "Questions answered", value: formatCount(questionsAnswered) },
              { label: "Not answered", value: formatCount(missedCount(questionsPresented, questionsAnswered)) },
              { label: "Questions presented", value: formatCount(questionsPresented) },
            ],
          }}
        />
        <StatCard
          label="My Engagement"
          value={formatPercent(latestAnalytics?.engagement_score)}
          icon={BarChart3}
          tone="role"
          detailPanel={{
            title: "Engagement details",
            description: "Combined learning activity score.",
            items: [
              { label: "Attendance", value: formatPercent(latestAnalytics?.attendance_rate) },
              { label: "Participation", value: formatPercent(latestAnalytics?.participation_rate) },
              { label: "Risk level", value: latestAnalytics?.risk_level || "No data" },
            ],
          }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <ChartCard title="Progress Trend" subtitle="Attendance, participation, and engagement score">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <XAxis dataKey="week" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} domain={[0, 100]} />
              <Tooltip />
              <Area type="monotone" dataKey="attendance" stroke="#2B7886" strokeWidth={3} fill="#2B788626" />
              <Area type="monotone" dataKey="participation" stroke="#79D99C" strokeWidth={3} fill="#79D99C33" />
              <Area type="monotone" dataKey="engagement" stroke="#245866" strokeWidth={3} fill="#24586622" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <DashboardCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge tone="role">Current class</Badge>
              <h2 className="mt-3 text-lg font-black text-slate-950 dark:text-white">{activeClass?.class_name ?? "No class selected"}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {activeClass ? `Instructor: ${activeClass.instructor_name || "To be announced"}` : "Select an enrolled class to focus this workspace."}
              </p>
            </div>
            <Link to="/student/session">
              <Button variant="outline">
                Live class
                <ArrowRight size={16} />
              </Button>
            </Link>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="rounded-lg bg-role-hover p-4 dark:bg-slate-950/30">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Active session</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {activeSession?.session_code ? `Session ${activeSession.session_code}` : "No active session joined"}
              </p>
            </div>
            <div className="rounded-lg bg-role-hover p-4 dark:bg-slate-950/30">
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">Next action</p>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Join the session code shared by your instructor, then answer the active live question.</p>
            </div>
          </div>
        </DashboardCard>
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Class access</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose the class context used by dashboard analytics and live session access.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => refreshSession()}>
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {studentClasses.length === 0 && (
            <div className="rounded-lg border border-dashed border-role-border bg-role-hover p-4 text-sm font-semibold text-slate-500 dark:bg-slate-950/30 dark:text-slate-300">
              No enrolled classes yet. Your instructor can add your account from class management.
            </div>
          )}
          {studentClasses.map((workspace) => (
            <button
              key={`${workspace.type}-${workspace.class_id}`}
              className="focus-ring rounded-lg bg-slate-50 p-4 text-left transition hover:bg-role-hover dark:bg-slate-950"
              type="button"
              onClick={() => selectWorkspace(workspace)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label ?? "Class"}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Instructor: {workspace.instructor_name || "To be announced"}</p>
                </div>
                <BookOpen className="shrink-0 text-role-primary" size={20} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Badge tone={currentWorkspace?.class_id === workspace.class_id ? "green" : "slate"}>
                  {currentWorkspace?.class_id === workspace.class_id ? "Active" : formatActivity(workspace.last_activity_at)}
                </Badge>
                <ArrowRight className="text-slate-400" size={16} />
              </div>
            </button>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

import { ArrowRight, BarChart3, BookOpen, Calendar, CheckCircle2, Radio, RefreshCw, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { PageHeader } from "../../components/PageHeader";
import { ProgressCard } from "../../components/ProgressCard";
import { useAuth } from "../../state/AuthContext";
import { useCurrentWorkspace } from "../../state/WorkspaceContext";

function formatActivity(value) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StudentDashboardPage() {
  const { workspaces, refreshSession } = useAuth();
  const { currentWorkspace, selectWorkspace } = useCurrentWorkspace();
  const studentClasses = workspaces.filter((workspace) => workspace.type === "student");
  const activeClass = currentWorkspace?.type === "student" ? currentWorkspace : studentClasses[0];

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Student home"
        title={activeClass?.class_name ? `Welcome to ${activeClass.class_name}` : "Your student workspace"}
        description="Track your classes, join live sessions, and keep your learning activity in one calm place."
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

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <DashboardCard className="bg-white dark:bg-slate-900">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Badge tone="role">Current class</Badge>
              <h2 className="mt-4 text-2xl font-black text-slate-950 dark:text-white">
                {activeClass?.class_name ?? "No class selected"}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {activeClass
                  ? `Instructor: ${activeClass.instructor_name || "To be announced"}`
                  : "Your instructor will enroll you before live classroom activity starts."}
              </p>
            </div>
            <Link to="/student/session">
              <Button variant="outline">
                Open session room
                <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        </DashboardCard>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <DashboardCard className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-role-soft text-role-primary">
              <BookOpen size={20} />
            </span>
            <div>
              <p className="text-xl font-black text-slate-950 dark:text-white">{studentClasses.length}</p>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Enrolled classes</p>
            </div>
          </DashboardCard>
          <DashboardCard className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-role-soft text-role-primary">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <p className="text-xl font-black text-slate-950 dark:text-white">5</p>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Answers today</p>
            </div>
          </DashboardCard>
          <DashboardCard className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-role-soft text-role-primary">
              <Sparkles size={20} />
            </span>
            <div>
              <p className="text-xl font-black text-slate-950 dark:text-white">82%</p>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Weekly mission</p>
            </div>
          </DashboardCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.78fr]">
        <DashboardCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Badge tone="teal">Enrolled classes</Badge>
              <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">Class access</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                These are assigned by your instructor. Pick a class to keep the dashboard focused.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => refreshSession()}>
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>

          <div className="mt-5 grid gap-3">
            {studentClasses.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-role-border bg-role-hover p-5 text-sm font-bold text-slate-500 dark:bg-slate-950/40 dark:text-slate-300">
                No enrolled classes yet. Your instructor will add your account from class management.
              </div>
            )}
            {studentClasses.map((workspace) => (
              <button
                key={`${workspace.type}-${workspace.class_id}`}
                className="focus-ring flex flex-col gap-3 rounded-[24px] border border-role-border bg-white p-4 text-left transition hover:border-role-primary hover:shadow-soft dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between"
                type="button"
                onClick={() => selectWorkspace(workspace)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-role-soft text-role-primary">
                    <BookOpen size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label ?? "Class"}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                      Instructor: {workspace.instructor_name || "To be announced"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={currentWorkspace?.class_id === workspace.class_id ? "green" : "slate"}>
                    {currentWorkspace?.class_id === workspace.class_id ? "Active" : formatActivity(workspace.last_activity_at)}
                  </Badge>
                  <ArrowRight className="text-slate-400" size={16} />
                </div>
              </button>
            ))}
          </div>
        </DashboardCard>

        <div className="grid gap-4">
          <DashboardCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-role-primary">Today</p>
                <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Live class schedule</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Join when your instructor shares the session code.</p>
              </div>
              <Calendar className="text-role-primary" />
            </div>
          </DashboardCard>
          <ProgressCard label="Weekly mission" value={82} badge="On track" tone="emerald" />
          <ProgressCard label="Question accuracy" value={76} badge="Rising" tone="gold" />
          <DashboardCard>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-role-soft text-role-primary">
                <BarChart3 size={22} />
              </span>
              <div>
                <h2 className="font-black text-slate-950 dark:text-white">Progress updates</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your answers and sessions will build this view over time.</p>
              </div>
            </div>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

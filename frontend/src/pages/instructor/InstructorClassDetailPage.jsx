import { ArrowLeft, ArrowRight, BookOpen, FileQuestion, FolderOpen, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { listClasses } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ClassEnrollmentPanel } from "../../components/ClassEnrollmentPanel";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

function isInactive(classDoc) {
  return ["inactive", "archived"].includes(String(classDoc?.status || "").toLowerCase());
}

export function InstructorClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [classDoc, setClassDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadClass() {
    setLoading(true);
    try {
      const allClasses = await listClasses({ includeInactive: true });
      const nextClass = allClasses.find((item) => item.class_id === classId);
      if (!nextClass) {
        showToast({ title: "Class not found", tone: "error" });
        navigate("/instructor/classes", { replace: true });
        return;
      }
      setClassDoc(nextClass);
      localStorage.setItem("instructorSelectedClassId", nextClass.class_id);
      localStorage.setItem("instructorSelectedClassName", nextClass.name);
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not load class", tone: "error" });
      navigate("/instructor/classes", { replace: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClass();
  }, [classId]);

  if (loading) {
    return (
      <div className="page-grid">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading class...</p>
        </DashboardCard>
      </div>
    );
  }

  if (!classDoc) {
    return (
      <div className="page-grid">
        <EmptyState title="Class unavailable" description="Choose another assigned class." />
      </div>
    );
  }

  const inactive = isInactive(classDoc);
  const classActions = [
    {
      title: "Create questions",
      description: "Generate prompts from uploaded class material.",
      icon: FileQuestion,
      to: "/instructor/content-studio",
    },
    {
      title: "Open content studio",
      description: "Review, approve, and organize class content.",
      icon: FolderOpen,
      to: "/instructor/content-studio",
    },
    {
      title: "Start live session",
      description: "Create or open a live class activity.",
      icon: Radio,
      to: "/instructor/sessions",
    },
  ];

  return (
    <div className="page-grid">
      <PageHeader
        title={classDoc.name}
        description="This class is institution-owned. Admins manage class records, instructor assignment, and enrollments."
        action={
          <Button type="button" variant="outline" onClick={() => navigate("/instructor/classes")}>
            <ArrowLeft size={17} />
            My Assigned Classes
          </Button>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(24rem,1.08fr)]">
        <div className="grid gap-4">
          <DashboardCard className="overflow-hidden rounded-2xl border-slate-200/80 p-0 shadow-[0_10px_26px_rgba(15,23,42,0.045)] dark:border-slate-800">
            <div className="flex flex-col gap-3 border-b border-role-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-role-hover text-role-accent dark:bg-slate-950">
                  <BookOpen size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-black text-slate-950 dark:text-white">Class profile</h2>
                    {classDoc.semester && <Badge tone="violet">{classDoc.semester}</Badge>}
                    <Badge tone={inactive ? "slate" : "green"}>{inactive ? "Inactive" : "Active"}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">Class details are managed by administrators.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="rounded-xl bg-role-hover px-4 py-3 dark:bg-slate-950/50">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Class name</p>
                <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{classDoc.name}</p>
              </div>
              <div className="rounded-xl bg-role-hover px-4 py-3 dark:bg-slate-950/50">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Semester</p>
                <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{classDoc.semester || "Not set"}</p>
              </div>
              <div className="rounded-xl bg-role-hover px-4 py-3 dark:bg-slate-950/50 md:col-span-2">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</p>
                <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">{classDoc.description || "No description provided."}</p>
              </div>
            </div>
          </DashboardCard>

          <DashboardCard className="overflow-hidden rounded-2xl border-slate-200/80 p-0 shadow-[0_10px_26px_rgba(15,23,42,0.045)] dark:border-slate-800">
            <div className="border-b border-role-border px-5 py-4">
              <h2 className="text-base font-black text-slate-950 dark:text-white">Class actions</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">Manage teaching content and live work for this assigned class.</p>
            </div>
            <div className="divide-y divide-role-border">
              {classActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.title}
                    type="button"
                    disabled={inactive}
                    onClick={() => navigate(action.to)}
                    className="group flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-role-hover disabled:cursor-not-allowed disabled:opacity-55 dark:hover:bg-slate-950/60"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-role-hover text-role-accent transition group-hover:bg-white dark:bg-slate-950 dark:group-hover:bg-slate-900">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-slate-950 dark:text-white">{action.title}</span>
                      <span className="mt-0.5 block text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{action.description}</span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-role-primary" />
                  </button>
                );
              })}
            </div>
          </DashboardCard>
        </div>

        <ClassEnrollmentPanel classDoc={classDoc} className="xl:min-h-[31.5rem]" readOnly />
      </div>
    </div>
  );
}

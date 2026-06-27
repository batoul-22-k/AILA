import { ArrowRight, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { listClasses } from "../../api/client";
import { Badge } from "../../components/Badge";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

function isInactive(classDoc) {
  return ["inactive", "archived"].includes(String(classDoc.status || "").toLowerCase());
}

export function InstructorClassesPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadClasses() {
    setLoading(true);
    try {
      const allClasses = await listClasses({ includeInactive: true });
      setClasses(allClasses);
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  function openClass(classDoc) {
    navigate(`/instructor/classes/${classDoc.class_id}`);
  }

  const activeCount = classes.filter((classDoc) => !isInactive(classDoc)).length;
  const inactiveCount = classes.filter((classDoc) => isInactive(classDoc)).length;

  return (
    <div className="page-grid">
      <PageHeader title="My Assigned Classes" description="Classes are assigned by the institution administrator or institution sync." />

      <div className="grid gap-3 sm:grid-cols-3">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Active</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{activeCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Inactive</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{inactiveCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Assigned</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{classes.length}</p>
        </DashboardCard>
      </div>

      <DashboardCard>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
            <BookOpen size={20} />
          </span>
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Assigned classes</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Open a class to manage lectures, questions, sessions, and participation.</p>
          </div>
        </div>

        {loading && <p className="mt-5 text-sm font-semibold text-slate-500">Loading assigned classes...</p>}
        {!loading && classes.length === 0 && (
          <div className="mt-5">
            <EmptyState title="No assigned classes" description="No classes have been assigned by the institution administrator." />
          </div>
        )}

        <div className="mt-5 grid gap-3">
          {classes.map((classDoc) => (
            <button
              key={classDoc.class_id}
              type="button"
              onClick={() => openClass(classDoc)}
              className="focus-ring rounded-[var(--role-radius)] border border-role-border bg-white p-4 text-left transition-all duration-300 hover:border-role-accent dark:bg-slate-900"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-950 dark:text-white">{classDoc.name}</h3>
                  {classDoc.description && <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{classDoc.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {classDoc.semester && <Badge tone="violet">{classDoc.semester}</Badge>}
                  <Badge tone={isInactive(classDoc) ? "slate" : "green"}>{isInactive(classDoc) ? "Inactive" : "Active"}</Badge>
                  <Badge tone="teal">
                    <ArrowRight size={13} />
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DashboardCard>
    </div>
  );
}

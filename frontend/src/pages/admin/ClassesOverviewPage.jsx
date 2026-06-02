import { BookOpen, Filter, Power, PowerOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { deleteClass, listClasses, updateClassStatus } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ClassEnrollmentPanel } from "../../components/ClassEnrollmentPanel";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function ClassesOverviewPage() {
  const { showToast } = useToast();
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function loadClasses() {
    setLoading(true);
    try {
      const result = await listClasses({ includeInactive: true });
      setClasses(result);
      setSelectedClassId((current) => current || result.find((classDoc) => classDoc.status !== "Inactive")?.class_id || result[0]?.class_id || "");
    } catch (err) {
      showToast({ title: "Could not load classes", description: err instanceof Error ? err.message : "Could not load classes", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleClassStatus(nextStatus) {
    if (!selectedClass) return;
    setUpdatingStatus(true);
    try {
      const updated = await updateClassStatus(selectedClass.class_id, nextStatus);
      setClasses((current) => current.map((classDoc) => (classDoc.class_id === updated.class_id ? updated : classDoc)));
      showToast({
        title: nextStatus === "Inactive" ? "Class deactivated" : "Class activated",
        description: nextStatus === "Inactive" ? `${updated.name} is now inactive. Active sessions were stopped.` : `${updated.name} is active again.`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not update class status", description: err instanceof Error ? err.message : "Could not update class status", tone: "error" });
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDeleteClass() {
    if (!selectedClass) return;
    const confirmed = window.confirm(`Delete ${selectedClass.name}? This is only for classes created by mistake and cannot be undone.`);
    if (!confirmed) return;
    setUpdatingStatus(true);
    try {
      await deleteClass(selectedClass.class_id);
      setClasses((current) => current.filter((classDoc) => classDoc.class_id !== selectedClass.class_id));
      setSelectedClassId("");
      showToast({ title: "Class deleted", description: `${selectedClass.name} was removed.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not delete class", description: err instanceof Error ? err.message : "Could not delete class", tone: "error" });
    } finally {
      setUpdatingStatus(false);
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  const selectedClass = classes.find((classDoc) => classDoc.class_id === selectedClassId);
  const activeCount = classes.filter((classDoc) => classDoc.status !== "Inactive").length;
  const inactiveCount = classes.filter((classDoc) => classDoc.status === "Inactive").length;

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Classes"
        title="Classes overview"
        description="Manage class records and student enrollment across the institution."
        tone="orange"
        action={
          <Button variant="outline" type="button" onClick={loadClasses}>
            <Filter size={17} />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Active classes</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{activeCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Inactive classes</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{inactiveCount}</p>
        </DashboardCard>
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total classes</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{classes.length}</p>
        </DashboardCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <DashboardCard>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
              <BookOpen size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Class Records</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{classes.length} classes available.</p>
            </div>
          </div>

          {loading && <p className="mt-5 text-sm font-semibold text-slate-500">Loading classes...</p>}
          {!loading && classes.length === 0 && <EmptyState title="No classes found" description="Classes created by instructors will appear here." />}

          <div className="mt-5 grid gap-3">
            {classes.map((classDoc) => (
              <button
                key={classDoc.class_id}
                type="button"
                onClick={() => setSelectedClassId(classDoc.class_id)}
                className={`focus-ring rounded-[var(--role-radius)] border p-4 text-left transition-all duration-300 ${
                  selectedClassId === classDoc.class_id
                    ? "border-role-accent bg-role-hover"
                    : "border-role-border bg-white hover:border-role-accent dark:bg-slate-900"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-black text-slate-950 dark:text-white">{classDoc.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{classDoc.description || "No description"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {classDoc.semester && <Badge tone="orange">{classDoc.semester}</Badge>}
                    <Badge tone={classDoc.status === "Inactive" ? "slate" : "green"}>{classDoc.status ?? "Active"}</Badge>
                    <Badge tone="slate">{classDoc.class_id}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedClass && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-[var(--role-radius)] border border-role-border bg-role-hover p-3">
              <Badge tone={selectedClass.status === "Inactive" ? "slate" : "green"}>{selectedClass.status === "Inactive" ? "Inactive" : "Active"}</Badge>
              <div className="flex items-center gap-2">
                {selectedClass.status === "Inactive" ? (
                  <button
                    type="button"
                    aria-label="Activate class"
                    title="Activate class"
                    disabled={updatingStatus}
                    onClick={() => handleClassStatus("Active")}
                    className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-role-primary transition hover:border-role-primary disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900"
                  >
                    <Power size={17} />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Deactivate class"
                    title="Deactivate class"
                    disabled={updatingStatus}
                    onClick={() => handleClassStatus("Inactive")}
                    className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-role-border bg-white text-slate-600 transition hover:border-role-primary hover:text-role-primary disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <PowerOff size={17} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Delete class"
                  title="Delete class"
                  disabled={updatingStatus}
                  onClick={handleDeleteClass}
                  className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-red-100 bg-red-50 text-red-600 transition hover:border-red-200 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          )}
        </DashboardCard>

        <ClassEnrollmentPanel classDoc={selectedClass} tone="orange" />
      </div>
    </div>
  );
}

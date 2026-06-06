import { ArrowLeft, BookOpen, Power, PowerOff, Save, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { deleteClass, listClasses, updateClass, updateClassStatus } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ClassEnrollmentPanel } from "../../components/ClassEnrollmentPanel";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

function toSettings(classDoc) {
  return {
    name: classDoc.name,
    description: classDoc.description || "",
    semester: classDoc.semester || "",
  };
}

export function InstructorClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [classDoc, setClassDoc] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function loadClass() {
    setLoading(true);
    try {
      const allClasses = await listClasses({ includeInactive: true });
      const nextClass = allClasses.find((item) => item.class_id === classId);
      if (!nextClass) {
        showToast({ title: "Class not found", description: "The selected class could not be found.", tone: "error" });
        navigate("/instructor/classes", { replace: true });
        return;
      }
      setClassDoc(nextClass);
      setSettings(toSettings(nextClass));
      localStorage.setItem("instructorSelectedClassId", nextClass.class_id);
      localStorage.setItem("instructorSelectedClassName", nextClass.name);
    } catch (err) {
      showToast({ title: "Could not load class", description: err instanceof Error ? err.message : "Could not load class", tone: "error" });
      navigate("/instructor/classes", { replace: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClass();
  }, [classId]);

  async function handleSaveSettings(event) {
    event.preventDefault();
    if (!classId || !settings) return;
    setSaving(true);
    try {
      const saved = await updateClass(classId, settings);
      setClassDoc(saved);
      setSettings(toSettings(saved));
      localStorage.setItem("instructorSelectedClassName", saved.name);
      showToast({ title: "Class settings saved", description: `${saved.name} was updated.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not save class settings", description: err instanceof Error ? err.message : "Could not save class settings", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleClassStatus(nextStatus) {
    if (!classId || !classDoc) return;
    setUpdatingStatus(true);
    try {
      const updated = await updateClassStatus(classId, nextStatus);
      setClassDoc(updated);
      setSettings(toSettings(updated));
      window.dispatchEvent(new window.Event("instructor-classes-changed"));
      showToast({
        title: nextStatus === "inactive" ? "Class deactivated" : "Class activated",
        description: nextStatus === "inactive" ? `${updated.name} is now inactive. Active sessions were stopped.` : `${updated.name} is active again.`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not update class status", description: err instanceof Error ? err.message : "Could not update class status", tone: "error" });
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDeleteClass() {
    if (!classId || !classDoc) return;
    const confirmed = window.confirm(`Delete ${classDoc.name}? This is only for classes created by mistake and cannot be undone.`);
    if (!confirmed) return;
    setUpdatingStatus(true);
    try {
      await deleteClass(classId);
      window.dispatchEvent(new window.Event("instructor-classes-changed"));
      if (localStorage.getItem("instructorSelectedClassId") === classId) {
        localStorage.removeItem("instructorSelectedClassId");
        localStorage.removeItem("instructorSelectedClassName");
      }
      showToast({ title: "Class deleted", description: `${classDoc.name} was removed.`, tone: "success" });
      navigate("/instructor/classes", { replace: true });
    } catch (err) {
      showToast({ title: "Could not delete class", description: err instanceof Error ? err.message : "Could not delete class", tone: "error" });
    } finally {
      setUpdatingStatus(false);
    }
  }

  if (loading) {
    return (
      <div className="page-grid">
        <DashboardCard>
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading class management...</p>
        </DashboardCard>
      </div>
    );
  }

  if (!classDoc || !settings) {
    return (
      <div className="page-grid">
        <EmptyState title="Class unavailable" description="Return to class management and choose another class." />
      </div>
    );
  }

  const isInactive = classDoc.status === "inactive" || classDoc.status === "archived";

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Class management"
      
        action={
          <Button type="button" variant="outline" onClick={() => navigate("/instructor/classes")}>
            <ArrowLeft size={17} />
            All classes
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_0.95fr]">
        <DashboardCard>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Settings size={19} className="text-role-accent" />
                <h2 className="text-lg font-black text-slate-950 dark:text-white">Class Settings</h2>
              </div>
                          </div>
            <div className="flex flex-wrap items-center gap-2">
              {classDoc.semester && <Badge tone="violet">{classDoc.semester}</Badge>}
              <Badge tone={isInactive ? "slate" : "green"}>{isInactive ? "inactive" : "active"}</Badge>
              {isInactive ? (
                <button
                  type="button"
                  aria-label="Activate class"
                  title="Activate class"
                  disabled={updatingStatus}
                  onClick={() => handleClassStatus("active")}
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
                  onClick={() => handleClassStatus("inactive")}
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

          <form className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleSaveSettings}>
            <Input label="Class name" value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} required />
            <Input label="Semester" value={settings.semester} onChange={(event) => setSettings((current) => ({ ...current, semester: event.target.value }))} />
            <Button className="self-end" type="submit" variant="outline" loading={saving}>
              <Save size={17} />
              Save
            </Button>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 md:col-span-3">
              Description
              <textarea
                className="adaptive-input focus-ring min-h-28 border px-3 py-3 text-sm"
                value={settings.description}
                onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
          </form>

          <div className="mt-6 flex flex-col gap-3 rounded-[var(--role-radius)] border border-role-border bg-role-hover p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-role-accent shadow-sm">
                <BookOpen size={15} />
              </span>
              <div>
        
                <p className="text-sm text-slate-500 dark:text-slate-400">Build questions for this class.</p>
              </div>
            </div>
            <Button type="button" variant="role" disabled={isInactive} onClick={() => navigate("/instructor/content-studio")}>
              Open Studio
            </Button>
          </div>
        </DashboardCard>

        <ClassEnrollmentPanel classDoc={classDoc} />
      </div>
    </div>
  );
}

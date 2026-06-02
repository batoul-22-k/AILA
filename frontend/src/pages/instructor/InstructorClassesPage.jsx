import { ArrowRight, BookOpen, CheckCircle2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createClass, listClasses } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";

export function InstructorClassesPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(localStorage.getItem("instructorSelectedClassId") || "");
  const [form, setForm] = useState({
    name: "AI Fundamentals",
    description: "Interactive lecture engagement",
    semester: "Spring 2026",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadClasses() {
    setLoading(true);
    try {
      const allClasses = await listClasses({ includeInactive: true });
      setClasses(allClasses);
      const nextSelected = selectedClassId || allClasses.find((classDoc) => classDoc.status !== "Inactive")?.class_id || allClasses[0]?.class_id || "";
      if (nextSelected) {
        setSelectedClassId(nextSelected);
        localStorage.setItem("instructorSelectedClassId", nextSelected);
      }
    } catch (err) {
      showToast({ title: "Could not load classes", description: err instanceof Error ? err.message : "Could not load classes", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  function openClass(classDoc) {
    setSelectedClassId(classDoc.class_id);
    localStorage.setItem("instructorSelectedClassId", classDoc.class_id);
    localStorage.setItem("instructorSelectedClassName", classDoc.name);
    navigate(`/instructor/classes/${classDoc.class_id}`);
  }

  async function handleCreate(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await createClass(form);
      setClasses((current) => [created, ...current]);
      window.dispatchEvent(new Event("instructor-classes-changed"));
      showToast({ title: "Class created", description: `Created ${created.name}. Content Studio is ready for this class.`, tone: "success" });
      openClass(created);
    } catch (err) {
      showToast({ title: "Could not create class", description: err instanceof Error ? err.message : "Could not create class", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const activeCount = classes.filter((classDoc) => classDoc.status !== "Inactive").length;
  const inactiveCount = classes.filter((classDoc) => classDoc.status === "Inactive").length;

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Class Management"  
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
              <Plus size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Create Class</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Start here before uploading content.</p>
            </div>
          </div>
          <form className="mt-5 grid gap-4" onSubmit={handleCreate}>
            <Input label="Class name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            <Input label="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            <Input label="Semester" value={form.semester} onChange={(event) => setForm((current) => ({ ...current, semester: event.target.value }))} />
            <Button className="w-fit" type="submit" variant="role" loading={saving}>
              <Plus size={17} />
              Create class
            </Button>
          </form>
        </DashboardCard>

        <DashboardCard>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
              <BookOpen size={20} />
            </span>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Manage Classes</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{classes.length} class records available.</p>
            </div>
          </div>

          {loading && <p className="mt-5 text-sm font-semibold text-slate-500">Loading classes...</p>}
          {!loading && classes.length === 0 && <EmptyState title="No classes yet" description="Create a class before opening Content Studio." />}

          <div className="mt-5 grid gap-3">
            {classes.map((classDoc) => (
              <button
                key={classDoc.class_id}
                type="button"
                onClick={() => openClass(classDoc)}
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
                    {classDoc.semester && <Badge tone="violet">{classDoc.semester}</Badge>}
                    <Badge tone={classDoc.status === "Inactive" ? "slate" : "green"}>{classDoc.status ?? "Active"}</Badge>
                    {selectedClassId === classDoc.class_id && <Badge tone="green"><CheckCircle2 size={13} />Selected</Badge>}
                    <Badge tone="teal"><ArrowRight size={13} /></Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </DashboardCard>
      </div>
    </div>
  );
}

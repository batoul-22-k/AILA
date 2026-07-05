import { BookOpen, Plus, Power, PowerOff, Trash2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { createClass, deleteClass, getAdminClassesMonitoring, listClasses, listUsers, updateClassStatus } from "../../api/client";
import { AdminClassMonitoring } from "../../components/admin/AdminClassMonitoring";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ClassEnrollmentPanel } from "../../components/ClassEnrollmentPanel";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { StatusIcon } from "../../components/StatusIcon";
import { useToast } from "../../components/ToastProvider";

export function ClassesOverviewPage() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedClassId = searchParams.get("class") || "";
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [monitoring, setMonitoring] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    semester: "",
    course_code: "",
    section: "",
    department: "",
    year: "",
    institution_class_id: "",
    instructor_id: "",
  });

  const emptyCreateForm = {
    name: "",
    description: "",
    semester: "",
    course_code: "",
    section: "",
    department: "",
    year: "",
    institution_class_id: "",
    instructor_id: "",
  };

  async function loadClasses() {
    setLoading(true);
    try {
      const result = await listClasses({ includeInactive: true });
      const monitoringResult = await getAdminClassesMonitoring().catch(() => ({ classes: [] }));
      const userResult = await listUsers({ includeAll: true }).catch(() => []);
      setClasses(result);
      setMonitoring(monitoringResult.classes || []);
      setInstructors(userResult.filter((account) => account.account_role === "instructor"));
      setSelectedClassId((current) => {
        const requestedClass = result.find((classDoc) => classDoc.class_id === requestedClassId);
        return requestedClass?.class_id || current || result.find((classDoc) => classDoc.status !== "Inactive")?.class_id || result[0]?.class_id || "";
      });
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
        title: nextStatus === "inactive" ? "Class deactivated" : "Class activated",
        description: nextStatus === "inactive" ? `${updated.name} is now inactive. Running sessions were stopped.` : `${updated.name} is active again.`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not update class status", description: err instanceof Error ? err.message : "Could not update class status", tone: "error" });
    } finally {
      setUpdatingStatus(false);
    }
  }

  function patchCreateForm(patch) {
    setCreateForm((current) => ({ ...current, ...patch }));
  }

  function closeCreateModal() {
    if (creating) return;
    setCreateModalOpen(false);
    setCreateForm(emptyCreateForm);
  }

  async function handleCreateClass(event) {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await createClass({
        name: createForm.name,
        description: createForm.description || null,
        semester: createForm.semester || null,
        course_code: createForm.course_code || null,
        section: createForm.section || null,
        department: createForm.department || null,
        year: createForm.year || null,
        institution_class_id: createForm.institution_class_id || null,
        instructor_id: createForm.instructor_id || null,
      });
      setClasses((current) => [created, ...current]);
      setSelectedClassId(created.class_id);
      setCreateModalOpen(false);
      setCreateForm(emptyCreateForm);
      showToast({ title: "Class created", description: `${created.name} is ready for admin-managed enrollment.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not create class", description: err instanceof Error ? err.message : "Could not create class", tone: "error" });
    } finally {
      setCreating(false);
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

  useEffect(() => {
    if (requestedClassId && classes.some((classDoc) => classDoc.class_id === requestedClassId)) {
      setSelectedClassId(requestedClassId);
    }
  }, [classes, requestedClassId]);

  const selectedClass = classes.find((classDoc) => classDoc.class_id === selectedClassId);
  const activeCount = classes.filter((classDoc) => String(classDoc.status || "").toLowerCase() !== "inactive").length;
  const inactiveCount = classes.filter((classDoc) => String(classDoc.status || "").toLowerCase() === "inactive").length;

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Classes"
        title="Classes overview"
        description="Manage class records and student enrollment across the institution."
        tone="orange"
        action={
          <div className="flex flex-wrap gap-2">
            <IconButton label="Refresh classes" icon={RefreshCw} onClick={loadClasses} />
            <Button variant="orange" type="button" onClick={() => setCreateModalOpen(true)}>
              <Plus size={17} />
              Create class
            </Button>
          </div>
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

      <AdminClassMonitoring classes={monitoring} />

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
          {!loading && classes.length === 0 && <EmptyState title="No classes found" description="Create classes manually or import them through institution sync." />}

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
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {[classDoc.course_code, classDoc.section, classDoc.year, classDoc.department].filter(Boolean).join(" / ") || classDoc.institution_class_id || "Manual class"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {classDoc.course_code && <Badge tone="teal">{classDoc.course_code}</Badge>}
                    {classDoc.semester && <Badge tone="orange">{classDoc.semester}</Badge>}
                    <StatusIcon status={String(classDoc.status || "active").toLowerCase() === "inactive" ? "Inactive" : "Active"} type="intervention" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedClass && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-[var(--role-radius)] border border-role-border bg-role-hover p-3">
              <StatusIcon status={String(selectedClass.status || "active").toLowerCase() === "inactive" ? "Inactive" : "Active"} type="intervention" />
              <div className="flex items-center gap-2">
                {String(selectedClass.status || "").toLowerCase() === "inactive" ? (
                  <IconButton label="Activate class" icon={Power} disabled={updatingStatus} onClick={() => handleClassStatus("active")} tone="role" />
                ) : (
                  <IconButton label="Deactivate class" icon={PowerOff} disabled={updatingStatus} onClick={() => handleClassStatus("inactive")} />
                )}
                <IconButton label="Delete class" icon={Trash2} disabled={updatingStatus} onClick={handleDeleteClass} tone="danger" />
              </div>
            </div>
          )}
        </DashboardCard>

        <ClassEnrollmentPanel classDoc={selectedClass} tone="orange" />
      </div>

      <Modal
        open={createModalOpen}
        title="Create class"
        onClose={closeCreateModal}
        closeDisabled={creating}
        bodyClassName="pb-10"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeCreateModal} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-class-form" variant="orange" loading={creating}>
              <Plus size={17} />
              Create class
            </Button>
          </div>
        }
      >
        <form id="create-class-form" className="grid gap-3" onSubmit={handleCreateClass}>
          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-950 dark:text-white">Basic class info</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Name the class and add a short context note for admins.</p>
            </div>
            <Input label="Class name" value={createForm.name} onChange={(event) => patchCreateForm({ name: event.target.value })} placeholder="Data Literacy" required />
            <Input label="Description" value={createForm.description} onChange={(event) => patchCreateForm({ description: event.target.value })} placeholder="Optional" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Course code" value={createForm.course_code} onChange={(event) => patchCreateForm({ course_code: event.target.value })} placeholder="CS201" />
              <Input label="Institution class ID" value={createForm.institution_class_id} onChange={(event) => patchCreateForm({ institution_class_id: event.target.value })} placeholder="CS201-A-2026" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Section" value={createForm.section} onChange={(event) => patchCreateForm({ section: event.target.value })} placeholder="A" />
              <Input label="Year" value={createForm.year} onChange={(event) => patchCreateForm({ year: event.target.value })} placeholder="2026" />
              <Input label="Semester" value={createForm.semester} onChange={(event) => patchCreateForm({ semester: event.target.value })} placeholder="Spring 2026" />
            </div>
            <Input label="Department" value={createForm.department} onChange={(event) => patchCreateForm({ department: event.target.value })} placeholder="Computer Science" />
          </section>

          <section className="grid gap-3 rounded-[var(--role-radius)] border border-role-border bg-role-hover p-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-black text-slate-950 dark:text-white">Instructor assignment</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Assign an instructor now, or leave this for institution sync.</p>
            </div>
            <label className="grid gap-1.5 text-sm font-semibold text-role-text dark:text-slate-200">
              Instructor
              <select
                className="adaptive-input focus-ring h-11 border px-4 text-sm text-role-text shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                value={createForm.instructor_id}
                onChange={(event) => patchCreateForm({ instructor_id: event.target.value })}
              >
                <option value="">Assign later</option>
                {instructors.map((instructor) => (
                  <option key={instructor.user_id} value={instructor.user_id}>
                    {instructor.name} - {instructor.email}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="grid gap-2 rounded-[var(--role-radius)] border border-role-border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-black text-slate-950 dark:text-white">Enrollment settings</h3>
            <p className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
              Student enrollment is managed after creation through the enrollment panel or institution sync.
            </p>
          </section>
        </form>
      </Modal>
    </div>
  );
}

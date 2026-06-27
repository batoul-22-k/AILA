import { Plus, Trash2, UserRound, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { enrollClassStudent, listClassStudents, listUsers, removeClassStudent } from "../api/client";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";
import { EmptyState } from "./EmptyState";
import { useToast } from "./ToastProvider";

function isStudentCandidate(user) {
  return user.account_role === "student";
}

export function ClassEnrollmentPanel({ classDoc, tone = "role", className = "", readOnly = false }) {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const enrolledIds = useMemo(() => new Set(students.map((student) => student.user_id)), [students]);
  const candidates = users.filter((user) => isStudentCandidate(user) && !enrolledIds.has(user.user_id));

  async function loadEnrollment() {
    if (!classDoc?.class_id) return;
    setLoading(true);
    try {
      const [usersResult, studentsResult] = await Promise.all([
        readOnly ? Promise.resolve([]) : listUsers(),
        listClassStudents(classDoc.class_id),
      ]);
      setUsers(usersResult);
      setStudents(studentsResult);
      setSelectedUserId((current) => (usersResult.some((user) => user.user_id === current) ? current : ""));
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not load enrollment", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEnrollment();
  }, [classDoc?.class_id]);

  async function handleEnroll(event) {
    event.preventDefault();
    if (!classDoc?.class_id || !selectedUserId) return;
    setSaving(true);
    try {
      const enrolled = await enrollClassStudent(classDoc.class_id, selectedUserId);
      setStudents((current) => [enrolled, ...current.filter((student) => student.user_id !== enrolled.user_id)]);
      setSelectedUserId("");
      showToast({ title: "Enrolled", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not enroll student", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(student) {
    if (!classDoc?.class_id) return;
    setSaving(true);
    try {
      await removeClassStudent(classDoc.class_id, student.user_id);
      setStudents((current) => current.filter((item) => item.user_id !== student.user_id));
      showToast({ title: "Removed", tone: "success" });
    } catch (err) {
      showToast({ title: "Something went wrong", description: err instanceof Error ? err.message : "Could not remove student", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (!classDoc) {
    return (
      <DashboardCard>
        <EmptyState title="Select a class" description="Choose a class first." />
      </DashboardCard>
    );
  }

  const inactive = ["inactive", "archived"].includes(String(classDoc.status || "").toLowerCase());

  return (
    <DashboardCard className={`flex flex-col overflow-hidden rounded-2xl border-slate-200/80 p-0 shadow-[0_10px_26px_rgba(15,23,42,0.045)] dark:border-slate-800 ${className}`}>
      <div className="flex flex-col gap-3 border-b border-role-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-role-hover text-role-accent dark:bg-slate-950">
            <UsersRound size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-slate-950 dark:text-white">Students</h2>
              <Badge tone={tone === "orange" ? "orange" : "green"}>{students.length} enrolled</Badge>
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {readOnly ? "View the roster assigned by administrators or institution sync." : "Manage the roster for live participation."}
            </p>
          </div>
        </div>
      </div>

      {!readOnly && (
        <form className="grid gap-3 border-b border-role-border px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={handleEnroll}>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <select
              className="adaptive-input focus-ring h-10 rounded-lg border px-3 text-sm shadow-none dark:border-slate-700 dark:bg-slate-900"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              disabled={inactive || loading || candidates.length === 0}
            >
              <option value="">{candidates.length === 0 ? "No available students" : "Choose a student"}</option>
              {candidates.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.name} - {user.email}
                </option>
              ))}
            </select>
          </label>
          <Button className="h-10 sm:self-end" type="submit" size="sm" variant={tone === "orange" ? "orange" : "role"} loading={saving} disabled={inactive || !selectedUserId}>
            <Plus size={15} />
            Enroll
          </Button>
        </form>
      )}

      <div className="min-h-0 flex-1 px-5 py-3">
        {loading && <p className="py-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading enrollment...</p>}
        {!loading && students.length === 0 && (
          <div className="py-4">
            <EmptyState title="No students" description={readOnly ? "No students are currently enrolled." : "Enroll students to begin."} />
          </div>
        )}
        {!loading && students.length > 0 && (
          <div className="max-h-[30rem] overflow-y-auto rounded-lg border border-role-border bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className={`grid ${readOnly ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_2.5rem]"} border-b border-role-border bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400`}>
              <span>Student</span>
              {!readOnly && <span className="text-right">Remove</span>}
            </div>
            <div className="divide-y divide-role-border">
              {students.map((student) => (
                <div key={student.user_id} className={`grid min-h-16 ${readOnly ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_2.5rem]"} items-center gap-3 px-4 py-2.5 transition hover:bg-role-hover/70 dark:hover:bg-slate-950/60`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-role-hover text-role-accent dark:bg-slate-950">
                      <UserRound size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950 dark:text-white">{student.name}</p>
                      <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">{student.email}</p>
                    </div>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${student.name}`}
                      title="Remove student"
                      onClick={() => handleRemove(student)}
                      disabled={inactive || saving}
                      className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-transparent text-slate-400 transition hover:border-red-100 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-red-400/20 dark:hover:bg-red-400/10 dark:hover:text-red-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

import { GraduationCap, Plus, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { enrollClassStudent, listClassStudents, listUsers, removeClassStudent } from "../api/client";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { DashboardCard } from "./DashboardCard";
import { EmptyState } from "./EmptyState";
import { useToast } from "./ToastProvider";

function isStudentCandidate(user) {
  const roles = user.roles || user.class_roles || user.workspaces?.map((workspace) => workspace.type) || [];
  return user.global_role !== "admin" && !roles.includes("admin") && !roles.includes("instructor") && user.role !== "admin" && user.role !== "instructor";
}

export function ClassEnrollmentPanel({ classDoc, tone = "role" }) {
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
      const [usersResult, studentsResult] = await Promise.all([listUsers(), listClassStudents(classDoc.class_id)]);
      setUsers(usersResult);
      setStudents(studentsResult);
      setSelectedUserId((current) => (usersResult.some((user) => user.user_id === current) ? current : ""));
    } catch (err) {
      showToast({ title: "Could not load enrollment", description: err instanceof Error ? err.message : "Could not load enrollment", tone: "error" });
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
      showToast({ title: "Student enrolled", description: `${enrolled.name} enrolled in ${classDoc.name}.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not enroll student", description: err instanceof Error ? err.message : "Could not enroll student", tone: "error" });
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
      showToast({ title: "Student removed", description: `${student.name} removed from ${classDoc.name}.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not remove student", description: err instanceof Error ? err.message : "Could not remove student", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (!classDoc) {
    return (
      <DashboardCard>
        <EmptyState title="Select a class" description="Choose a class before managing student enrollment." />
      </DashboardCard>
    );
  }

  const inactive = classDoc.status === "Inactive" || classDoc.status === "Archived";

  return (
    <DashboardCard>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
            <UsersRound size={20} />
          </span>
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Student Enrollment</h2>
            {/* <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {inactive ? `${classDoc.name} is inactive. Activate it before changing enrollment.` : `Add students who can join live sessions for ${classDoc.name}.`}
            </p> */}
          </div>
        </div>
        <Badge tone={tone === "orange" ? "orange" : "green"}>{students.length} enrolled</Badge>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleEnroll}>
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Add student
          <select
            className="adaptive-input focus-ring h-11 border px-3 text-sm"
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
        <Button className="self-end" type="submit" variant={tone === "orange" ? "orange" : "role"} loading={saving} disabled={inactive || !selectedUserId}>
          <Plus size={17} />
          Enroll
        </Button>
      </form>

      <div className="mt-5 grid gap-3">
        {loading && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading enrollment...</p>}
        {!loading && students.length === 0 && <EmptyState title="No students enrolled" description="Enroll students before sharing session codes for this class." />}
        {students.map((student) => (
          <div key={student.user_id} className="flex flex-col gap-3 rounded-[var(--role-radius)] border border-role-border bg-white p-4 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
                <GraduationCap size={19} />
              </span>
              <div>
                <p className="font-black text-slate-950 dark:text-white">{student.name}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{student.email}</p>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => handleRemove(student)} disabled={inactive || saving}>
              <Trash2 size={16} />
              
            </Button>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}

import {
  BookOpen,
  CheckCircle2,
  Database,
  GraduationCap,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { applyInstitutionSync, createManualAccount, deleteUser, listUsers, previewInstitutionSync } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { TableHeaderFilter, TableToolbar } from "../../components/table";
import { useToast } from "../../components/ToastProvider";

const accountRoles = [
  { value: "student", label: "Student", icon: GraduationCap },
  { value: "instructor", label: "Instructor", icon: BookOpen },
  { value: "admin", label: "Admin", icon: ShieldCheck },
];

const previewFilters = [
  { value: "all", label: "All" },
  { value: "student", label: "Students" },
  { value: "instructor", label: "Instructors" },
  { value: "admin", label: "Admins" },
  { value: "invalid", label: "Invalid" },
];

const emptyManualForm = {
  full_name: "",
  email: "",
  account_role: "student",
  institution_id: "",
  department: "",
  class_name: "",
};

function roleLabel(user) {
  const role = user.account_role || user.role || "student";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function roleTone(user) {
  const role = user.account_role || user.role;
  if (role === "student") return "green";
  if (role === "instructor") return "teal";
  return "orange";
}

function statusTone(status) {
  if (status === "New") return "green";
  if (status === "Existing") return "slate";
  if (status === "Missing data") return "gold";
  return "red";
}

function isInvalidPreview(row) {
  return row.sync_status === "Invalid" || row.sync_status === "Missing data";
}

function classMetadata(row) {
  const classes = row.account_role === "instructor" ? row.assigned_classes : row.enrolled_classes;
  if (classes?.length) {
    return classes
      .map((classRow) => [classRow.course_code, classRow.name, classRow.section].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ");
  }
  return [row.department, row.class_name].filter(Boolean).join(" / ") || "Not provided";
}

export function AdminAccountsPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [syncPreview, setSyncPreview] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [previewFilter, setPreviewFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteVerification, setDeleteVerification] = useState("");

  useEffect(() => {
    async function loadUsers() {
      setLoadingUsers(true);
      try {
        const usersResult = await listUsers({ includeAll: true });
        setUsers(usersResult);
      } catch (err) {
        showToast({ title: "Could not load accounts", description: err instanceof Error ? err.message : "Could not load accounts", tone: "error" });
      } finally {
        setLoadingUsers(false);
      }
    }

    loadUsers();
  }, [showToast]);

  const adminCount = users.filter((user) => user.account_role === "admin").length;
  const instructorCount = users.filter((user) => user.account_role === "instructor").length;
  const studentCount = users.filter((user) => user.account_role === "student").length;
  const syncedCount = users.filter((user) => user.created_by_sync).length;
  const validPreviewCount = previewRows.filter((row) => row.can_sync).length;

  const filteredPreviewRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return previewRows.filter((row) => {
      const matchesFilter =
        previewFilter === "all" ||
        (previewFilter === "invalid" && isInvalidPreview(row)) ||
        row.account_role === previewFilter ||
        row.role === previewFilter;
      const matchesSearch =
        !query ||
        row.full_name.toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query) ||
        row.institution_id.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [previewFilter, previewRows, search]);

  const selectedValidRows = previewRows.filter((row) => row.can_sync && selectedIds.includes(row.institution_id));
  const allVisibleValidSelected =
    filteredPreviewRows.some((row) => row.can_sync) &&
    filteredPreviewRows.filter((row) => row.can_sync).every((row) => selectedIds.includes(row.institution_id));

  function patchManualForm(patch) {
    setManualForm((current) => ({ ...current, ...patch }));
  }

  async function loadInstitutionPreview({ notify = false } = {}) {
    setPreviewLoading(true);
    try {
      const result = await previewInstitutionSync();
      const rows = result.users || [];
      setSyncPreview(result);
      setPreviewRows(rows);
      setSelectedIds(rows.filter((row) => row.can_sync).map((row) => row.institution_id));
      if (notify) {
        showToast({
          title: "Institution sync preview ready",
          description: `${rows.filter((row) => row.can_sync).length} accounts can be synced with classes and enrollments.`,
          tone: "success",
        });
      }
    } catch (err) {
      showToast({ title: "Could not preview institution users", description: err instanceof Error ? err.message : "Could not preview institution users", tone: "error" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handlePreviewSync() {
    await loadInstitutionPreview({ notify: true });
  }

  function toggleSelected(institutionId) {
    setSelectedIds((current) => (current.includes(institutionId) ? current.filter((id) => id !== institutionId) : [...current, institutionId]));
  }

  function toggleVisibleValidRows() {
    const visibleValidIds = filteredPreviewRows.filter((row) => row.can_sync).map((row) => row.institution_id);
    setSelectedIds((current) => {
      if (visibleValidIds.every((id) => current.includes(id))) return current.filter((id) => !visibleValidIds.includes(id));
      return Array.from(new Set([...current, ...visibleValidIds]));
    });
  }

  async function handleConfirmImport() {
    if (selectedValidRows.length === 0) return;
    setImporting(true);
    try {
      const result = await applyInstitutionSync(selectedValidRows.map((row) => row.institution_id));
      setUsers((current) => [...(result.users || []), ...current.filter((user) => !(result.users || []).some((synced) => synced.user_id === user.user_id))]);
      setSelectedIds([]);
      await loadInstitutionPreview();
      showToast({
        title: "Sync complete",
        description: `${result.created_accounts} account${result.created_accounts === 1 ? "" : "s"} created, ${result.updated_accounts} updated.`,
        tone: "success",
      });
      const classWork = result.created_classes + result.student_enrollments_added + result.instructor_assignments_added;
      if (classWork > 0) {
        showToast({
          title: "Classes synced",
          description: `${result.created_classes} classes, ${result.student_enrollments_added} enrollments, ${result.instructor_assignments_added} instructor assignments added.`,
          tone: "success",
        });
      }
      if (result.skipped_existing_memberships > 0) {
        showToast({ title: "Existing memberships skipped", description: `${result.skipped_existing_memberships} memberships were already active.`, tone: "warning" });
      }
      if (result.invalid_records > 0) {
        showToast({ title: "Invalid records skipped", description: `${result.invalid_records} record${result.invalid_records === 1 ? "" : "s"} could not be synced.`, tone: "error" });
      }
    } catch (err) {
      showToast({ title: "Could not sync institution data", description: err instanceof Error ? err.message : "Could not sync institution data", tone: "error" });
    } finally {
      setImporting(false);
    }
  }

  function openManualModal() {
    setManualForm(emptyManualForm);
    setManualOpen(true);
  }

  function closeManualModal() {
    if (manualSaving) return;
    setManualOpen(false);
    setManualForm(emptyManualForm);
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    setManualSaving(true);
    try {
      const payload = {
        ...manualForm,
        institution_id: manualForm.institution_id || null,
        department: manualForm.department || null,
        class_name: manualForm.class_name || null,
      };
      const created = await createManualAccount(payload);
      setUsers((current) => [created, ...current.filter((user) => user.user_id !== created.user_id)]);
      setManualOpen(false);
      setManualForm(emptyManualForm);
      showToast({
        title: "Manual account added",
        description: `${created.name} was created. Invite or reset-password setup is pending.`,
        tone: "success",
      });
    } catch (err) {
      showToast({ title: "Could not add account", description: err instanceof Error ? err.message : "Could not add account", tone: "error" });
    } finally {
      setManualSaving(false);
    }
  }

  function openDeleteModal(user) {
    setDeleteTarget(user);
    setDeleteVerification("");
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteVerification("");
  }

  async function handleDeleteAccount() {
    if (!deleteTarget || deleteVerification !== "DELETE") return;
    setDeleting(true);
    try {
      await deleteUser(deleteTarget.user_id);
      setUsers((current) => current.filter((user) => user.user_id !== deleteTarget.user_id));
      showToast({ title: "Account deleted", description: `${deleteTarget.name} was removed.`, tone: "success" });
      setDeleteTarget(null);
      setDeleteVerification("");
    } catch (err) {
      showToast({ title: "Could not delete account", description: err instanceof Error ? err.message : "Could not delete account", tone: "error" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Account management" description="Sync institution identities, review changes before import, and keep manual adds as an exception path." tone="role" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total accounts" value={users.length} icon={Users} tone="role" />
        <StatCard label="Students" value={studentCount} icon={GraduationCap} tone="emerald" />
        <StatCard label="Instructors" value={instructorCount} icon={BookOpen} tone="teal" />
        <StatCard label="Admins" value={adminCount} icon={ShieldCheck} tone="gold" />
        <StatCard label="Synced" value={syncedCount} icon={Database} tone="gold" />
      </div>

      <DashboardCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-role-soft text-role-primary">
              <Database size={21} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-950 dark:text-white">Institution Sync</h2>
                <Badge tone="teal">Primary workflow</Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                Pull users, class rosters, and instructor assignments from the institution database. Preview the changes, then apply the selected valid records.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={openManualModal}>
              <UserPlus size={17} />
              Add account manually
            </Button>
            <Button type="button" variant="role" loading={previewLoading} onClick={handlePreviewSync}>
              <RefreshCw size={17} />
              Sync Institution Data
            </Button>
          </div>
        </div>

        {previewRows.length > 0 && (
          <div className="mt-5 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">New accounts</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.new_accounts ?? 0}</p>
              </div>
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Existing accounts</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.existing_accounts ?? 0}</p>
              </div>
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">New classes</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.new_classes ?? 0}</p>
              </div>
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Enrollments</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.student_enrollments_to_add ?? 0}</p>
              </div>
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Instructor assignments</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.instructor_assignments_to_add ?? 0}</p>
              </div>
              <div className="rounded-[18px] border border-role-border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Invalid records</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{syncPreview?.counts?.invalid_records ?? 0}</p>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-[18px] border border-role-border bg-role-hover/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <p className="text-sm font-black text-slate-950 dark:text-white">New classes</p>
                <div className="mt-3 grid gap-2">
                  {(syncPreview?.classes || []).filter((row) => row.status === "New").slice(0, 4).map((row) => (
                    <div key={row.class_key} className="rounded-xl bg-white px-3 py-2 text-sm dark:bg-slate-900">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{row.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{[row.course_code, row.section, row.year].filter(Boolean).join(" / ") || row.institution_class_id}</p>
                    </div>
                  ))}
                  {(syncPreview?.counts?.new_classes ?? 0) === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No new classes in this preview.</p>}
                </div>
              </div>
              <div className="rounded-[18px] border border-role-border bg-role-hover/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <p className="text-sm font-black text-slate-950 dark:text-white">Student enrollments to add</p>
                <div className="mt-3 grid gap-2">
                  {(syncPreview?.student_enrollments || []).filter((row) => row.status === "New").slice(0, 4).map((row) => (
                    <div key={`${row.institution_id}-${row.class_key}`} className="rounded-xl bg-white px-3 py-2 text-sm dark:bg-slate-900">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{row.full_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.class_name}</p>
                    </div>
                  ))}
                  {(syncPreview?.counts?.student_enrollments_to_add ?? 0) === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No new student enrollments.</p>}
                </div>
              </div>
              <div className="rounded-[18px] border border-role-border bg-role-hover/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <p className="text-sm font-black text-slate-950 dark:text-white">Instructor assignments to add</p>
                <div className="mt-3 grid gap-2">
                  {(syncPreview?.instructor_assignments || []).filter((row) => row.status === "New").slice(0, 4).map((row) => (
                    <div key={`${row.institution_id}-${row.class_key}`} className="rounded-xl bg-white px-3 py-2 text-sm dark:bg-slate-900">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{row.full_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.class_name}</p>
                    </div>
                  ))}
                  {(syncPreview?.counts?.instructor_assignments_to_add ?? 0) === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No new instructor assignments.</p>}
                </div>
              </div>
            </div>

            <TableToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search name, email, or institution ID"
              filters={[{
                key: "role-status",
                label: "Role/status",
                valueLabel: previewFilters.find((filter) => filter.value === previewFilter && filter.value !== "all")?.label,
                onClear: () => setPreviewFilter("all"),
              }]}
              onClearFilters={() => {
                setSearch("");
                setPreviewFilter("all");
              }}
            />

            <div className="flex flex-col gap-3 rounded-[18px] border border-role-border bg-role-hover/70 p-4 dark:border-slate-800 dark:bg-slate-950/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-black text-slate-950 dark:text-white">{selectedValidRows.length}</span> of {validPreviewCount} valid account records selected
              </div>
              <Button type="button" variant="role" loading={importing} disabled={selectedValidRows.length === 0} onClick={handleConfirmImport}>
                <CheckCircle2 size={17} />
                Apply sync
              </Button>
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-[var(--color-soft-surface)] text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">
                      <input type="checkbox" checked={allVisibleValidSelected} onChange={toggleVisibleValidRows} aria-label="Select visible valid users" />
                    </th>
                    <th className="px-4 py-2.5 font-semibold">Full name</th>
                    <th className="px-4 py-2.5 font-semibold">Email</th>
                    <th className="px-4 py-2.5 font-semibold">
                      <TableHeaderFilter
                        label="Role"
                        value={previewFilter === "all" ? "" : previewFilter}
                        onChange={(value) => setPreviewFilter(value || "all")}
                        allLabel="All"
                        options={previewFilters.filter((filter) => filter.value !== "all")}
                      />
                    </th>
                    <th className="px-4 py-2.5 font-semibold">Institution ID</th>
                    <th className="px-4 py-2.5 font-semibold">Department/Class</th>
                    <th className="px-4 py-2.5 font-semibold">Sync status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPreviewRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400" colSpan={7}>
                        No institution users match this view.
                      </td>
                    </tr>
                  )}
                  {filteredPreviewRows.map((row) => (
                    <tr key={row.institution_id || row.email} className="transition hover:bg-[var(--color-soft-surface)] dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.institution_id)}
                          disabled={!row.can_sync}
                          onChange={() => toggleSelected(row.institution_id)}
                          aria-label={`Select ${row.full_name || row.email}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{row.full_name || "Missing"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.email || "Missing"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={roleTone(row)}>{roleLabel(row)}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{row.institution_id || "Missing"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                        {classMetadata(row)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid gap-1">
                          <Badge tone={statusTone(row.sync_status)}>{row.sync_status}</Badge>
                          {row.reason && <span className="text-xs text-slate-500 dark:text-slate-400">{row.reason}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {filteredPreviewRows.map((row) => (
                <DashboardCard key={row.institution_id || row.email}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950 dark:text-white">{row.full_name || "Missing name"}</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{row.email || "Missing email"}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.institution_id)}
                      disabled={!row.can_sync}
                      onChange={() => toggleSelected(row.institution_id)}
                      aria-label={`Select ${row.full_name || row.email}`}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={roleTone(row)}>{roleLabel(row)}</Badge>
                    <Badge tone={statusTone(row.sync_status)}>{row.sync_status}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{row.institution_id || "Missing institution ID"}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{classMetadata(row)}</p>
                </DashboardCard>
              ))}
            </div>
          </div>
        )}
      </DashboardCard>

      <DashboardCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Accounts</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{loadingUsers ? "Loading accounts..." : "Newest accounts appear first. Synced accounts are marked clearly."}</p>
          </div>
          <Badge tone="slate">{users.length} records</Badge>
        </div>
        <div className="mt-5">
          <ResponsiveTable
            rows={users.map((user) => ({ ...user, id: user.user_id }))}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (user) => (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {user.name}
                    {user.created_by_sync && <Badge tone="teal">Synced</Badge>}
                  </span>
                ),
              },
              {
                key: "email",
                label: "Email",
                render: (user) => (
                  <span className="inline-flex items-center gap-2">
                    <Mail size={14} />
                    {user.email}
                  </span>
                ),
              },
              {
                key: "role",
                label: "Role",
                render: (user) => <Badge tone={roleTone(user)}>{roleLabel(user)}</Badge>,
              },
              {
                key: "institution_id",
                label: "Institution ID",
                render: (user) => <span className="font-mono text-xs">{user.institution_id || "Manual"}</span>,
              },
              {
                key: "user_id",
                label: "User ID",
                render: (user) => (
                  <span className="inline-flex items-center gap-2 font-mono text-xs">
                    <KeyRound size={14} />
                    {user.user_id}
                  </span>
                ),
              },
              {
                key: "actions",
                label: "Actions",
                render: (user) => (
                  <IconButton label="Delete account" icon={Trash2} tone="danger" onClick={() => openDeleteModal(user)} />
                ),
              },
            ]}
          />
        </div>
      </DashboardCard>

      <Modal open={manualOpen} title="Add account manually" onClose={closeManualModal} closeDisabled={manualSaving}>
        <form className="grid gap-4" onSubmit={handleManualSubmit}>
          <div className="rounded-[18px] border border-role-border bg-role-hover/70 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
            Manual accounts are created without showing a temporary password. Use the invite or reset-password setup when that flow is connected.
          </div>
          <Input label="Full name" value={manualForm.full_name} onChange={(event) => patchManualForm({ full_name: event.target.value })} placeholder="Maya Student" required />
          <Input label="Email" type="email" value={manualForm.email} onChange={(event) => patchManualForm({ email: event.target.value })} placeholder="name@example.com" required />
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-role-text dark:text-slate-200">Account type</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {accountRoles.map((role) => {
                const Icon = role.icon;
                const active = manualForm.account_role === role.value;
                return (
                  <button
                    key={role.value}
                    type="button"
                    onClick={() => patchManualForm({ account_role: role.value })}
                    className={`focus-ring flex items-center justify-center gap-2 rounded-[18px] border px-3 py-2.5 text-sm font-black transition ${
                      active ? "border-role-primary bg-role-soft text-role-primary shadow-sm" : "border-role-border bg-white text-slate-600 hover:border-role-primary dark:bg-slate-900 dark:text-slate-200"
                    }`}
                  >
                    <Icon size={16} />
                    {role.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input label="Institution ID" value={manualForm.institution_id} onChange={(event) => patchManualForm({ institution_id: event.target.value })} placeholder="Optional" />
            <Input label="Department" value={manualForm.department} onChange={(event) => patchManualForm({ department: event.target.value })} placeholder="Optional" />
          </div>
          <Input label="Class metadata" value={manualForm.class_name} onChange={(event) => patchManualForm({ class_name: event.target.value })} placeholder="Optional class or cohort" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeManualModal} disabled={manualSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="role" loading={manualSaving}>
              <UserPlus size={17} />
              Add account
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(deleteTarget)} title="Delete account" onClose={closeDeleteModal} closeDisabled={deleting}>
        {deleteTarget && (
          <div className="grid gap-4">
            <div className="flex gap-3 rounded-[22px] border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">
              <TriangleAlert className="mt-0.5 shrink-0" size={20} />
              <div>
                <p className="text-sm font-black">This permanently removes the account.</p>
                <p className="mt-1 text-sm leading-6">
                  {deleteTarget.name} will lose access. Related class memberships, participation records, responses, and notifications will be removed.
                </p>
              </div>
            </div>

            <div className="rounded-[22px] bg-role-hover p-4 dark:bg-slate-950/40">
              <p className="text-sm font-black text-slate-950 dark:text-white">{deleteTarget.name}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{deleteTarget.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={roleTone(deleteTarget)}>{roleLabel(deleteTarget)}</Badge>
                {deleteTarget.created_by_sync && <Badge tone="teal">Synced</Badge>}
              </div>
            </div>

            <Input label="Type DELETE to confirm" value={deleteVerification} onChange={(event) => setDeleteVerification(event.target.value)} placeholder="DELETE" autoFocus />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeDeleteModal} disabled={deleting}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" loading={deleting} disabled={deleteVerification !== "DELETE"} onClick={handleDeleteAccount}>
                <Trash2 size={17} />
                Delete account
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

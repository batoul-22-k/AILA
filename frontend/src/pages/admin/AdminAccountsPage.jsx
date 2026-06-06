import { BookOpen, GraduationCap, KeyRound, Mail, ShieldCheck, Trash2, TriangleAlert, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { createUser, deleteUser, listUsers } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { ResponsiveTable } from "../../components/ResponsiveTable";
import { StatCard } from "../../components/StatCard";
import { useToast } from "../../components/ToastProvider";

const accountRoles = [
  { value: "student", label: "Student", icon: GraduationCap, tone: "green" },
  { value: "instructor", label: "Instructor", icon: BookOpen, tone: "teal" },
  { value: "admin", label: "Admin", icon: ShieldCheck, tone: "orange" },
];

function roleLabel(user) {
  return user.account_role.charAt(0).toUpperCase() + user.account_role.slice(1);
}

function roleTone(user) {
  if (user.account_role === "student") return "green";
  if (user.account_role === "instructor") return "teal";
  return "orange";
}

export function AdminAccountsPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteVerification, setDeleteVerification] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    account_role: "student",
  });

  useEffect(() => {
    async function load() {
      try {
        const usersResult = await listUsers({ includeAll: true });
        setUsers(usersResult);
      } catch (err) {
        showToast({ title: "Could not load accounts", description: err instanceof Error ? err.message : "Could not load accounts", tone: "error" });
      }
    }

    load();
  }, [showToast]);

  const adminCount = users.filter((user) => user.account_role === "admin").length;
  const standardCount = users.length - adminCount;

  function patchForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const created = await createUser(form);
      setUsers((current) => [created, ...current.filter((user) => user.user_id !== created.user_id)]);
      setForm({ name: "", email: "", password: "", account_role: "student" });
      showToast({ title: "Account created", description: `${created.name} can now sign in.`, tone: "success" });
    } catch (err) {
      showToast({ title: "Could not create account", description: err instanceof Error ? err.message : "Could not create account", tone: "error" });
    } finally {
      setLoading(false);
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
      <PageHeader eyebrow="Account management" description="Create student, instructor, and admin identities. Class access is assigned from class management." tone="role" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total accounts" value={users.length} icon={Users} tone="role" />
        <StatCard label="Standard users" value={standardCount} icon={GraduationCap} tone="emerald" />
        <StatCard label="Admins" value={adminCount} icon={ShieldCheck} tone="gold" />
      </div>

      <div className="grid gap-4 xl:grid-rows-[0.5fr_1.5fr]">
        <DashboardCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Create account</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose the account role. Assign class access later from the class workspace.</p>
            </div>
            <Badge tone="teal">Admin only</Badge>
          </div>

          <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Full name" value={form.name} onChange={(event) => patchForm({ name: event.target.value })} placeholder="Maya Student" required />
              <Input label="Email" type="email" value={form.email} onChange={(event) => patchForm({ email: event.target.value })} placeholder="name@example.com" required />
            </div>
            <Input
              label="Temporary password"
              type="text"
              value={form.password}
              onChange={(event) => patchForm({ password: event.target.value })}
              placeholder="demo-password"
              /* hint="Current auth stores this as the demo password field." */
              required
            />

            <div className="grid gap-2">
              <span className="text-sm font-semibold text-role-text dark:text-slate-200">Account type</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {accountRoles.map((role) => {
                  const Icon = role.icon;
                  const active = form.account_role === role.value;
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => patchForm({ account_role: role.value })}
                      className={`focus-ring flex items-center justify-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-black transition ${
                        active ? "border-role-primary bg-role-soft text-role-primary shadow-sm" : "border-role-border bg-white text-slate-600 hover:border-role-primary dark:bg-slate-900 dark:text-slate-200"
                      }`}
                    >
                      <Icon size={17} />
                      {role.label}
                    </button>
                  );
                })}
              </div>
            </div>

           {/*  <div className="rounded-[22px] border border-role-border bg-role-hover/70 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
              Student enrollment and instructor teaching access are managed from the class pages, so this form only creates the login identity.
            </div> */}

            <Button type="submit" size="lg" variant="role" loading={loading}>
              <UserPlus size={18} />
              Create account
            </Button>
          </form>
        </DashboardCard>

        <DashboardCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">Accounts</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Newest accounts appear first.</p>
            </div>
            <Badge tone="slate">{users.length} records</Badge>
          </div>
          <div className="mt-5">
            <ResponsiveTable
              rows={users.map((user) => ({ ...user, id: user.user_id }))}
              columns={[
                { key: "name", label: "Name" },
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
                    <Button type="button" variant="outline" size="sm" className="text-red-600 hover:border-red-300 hover:text-red-700" onClick={() => openDeleteModal(user)}>
                      <Trash2 size={15} />
                  
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </DashboardCard>
      </div>

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
              <Badge className="mt-3" tone={roleTone(deleteTarget)}>{roleLabel(deleteTarget)}</Badge>
            </div>

            <Input
              label="Type DELETE to confirm"
              value={deleteVerification}
              onChange={(event) => setDeleteVerification(event.target.value)}
              placeholder="DELETE"
              autoFocus
            />

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

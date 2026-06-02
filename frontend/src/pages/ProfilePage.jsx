import { Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../components/Button";
import { DashboardCard } from "../components/DashboardCard";
import { Input } from "../components/Input";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/ToastProvider";
import { useAuth } from "../state/AuthContext";

export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ name: user?.name ?? "", email: user?.email ?? "" });
  }, [user?.email, user?.name]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      showToast({ title: "Profile updated", description: "Your profile changes were saved.", tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update profile";
      showToast({ title: "Profile update failed", description: message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-grid">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Update your visible name and email for this workspace."
        tone="role"
      />

      <DashboardCard>
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[var(--role-radius)] bg-role-hover text-role-accent">
            <UserRound size={23} />
          </span>
          <div>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">{user?.name}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
          </div>
        </div>

        <form className="mt-6 grid max-w-2xl gap-4" onSubmit={handleSubmit}>
          <Input label="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          <Input label="Email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
          <Button className="w-fit" type="submit" variant="role" loading={saving}>
            <Save size={17} />
            Save profile
          </Button>
        </form>
      </DashboardCard>
    </div>
  );
}

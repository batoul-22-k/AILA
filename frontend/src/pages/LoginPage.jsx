import { LogIn } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { AilaIcon, AilaLogo } from "../components/AilaLogo";
import { Button } from "../components/Button";
import { DashboardCard } from "../components/DashboardCard";
import { Input } from "../components/Input";
import { ThemeToggle } from "../components/ThemeToggle";
import { useToast } from "../components/ToastProvider";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";

export function LoginPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { selectWorkspace, clearWorkspace } = useCurrentWorkspace();
  const [email, setEmail] = useState("batoul@example.com");
  const [password, setPassword] = useState("demo-password");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const auth = await login({ email, password });
      clearWorkspace();
      if (auth.workspaces.length === 1) {
        selectWorkspace(auth.workspaces[0]);
        navigate(`/${auth.workspaces[0].type}`, { replace: true });
      } else {
        navigate("/workspace-select", { replace: true });
      }
    } catch (err) {
      showToast({ title: "Login failed", description: err instanceof Error ? err.message : "Login failed", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout data-theme="staff" data-role="instructor">
      <main className="grid min-h-screen place-items-center px-4 py-8">
        <div className="w-full max-w-5xl">
          <header className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center shadow-soft">
                <AilaIcon className="h-7 w-7" />
              </span>
              <div>
                <AilaLogo className="w-28 text-[var(--role-text)]" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Unified classroom login</p>
              </div>
            </div>
            <ThemeToggle />
          </header>

          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-accent">Moodle-style access</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                AILA brings learning analytics and live class workflows into one workspace.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                Roles are resolved after login from your class memberships and global permissions.
              </p>
            </div>

            <DashboardCard>
              <form className="grid gap-4" onSubmit={handleSubmit}>
                <Input label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                <Input label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                <Button type="submit" size="lg" variant="role" loading={loading}>
                  <LogIn size={18} />
                  Log in
                </Button>
              </form>

              <div className="mt-5 rounded-[var(--role-radius)] bg-role-hover p-4 text-xs font-semibold leading-6 text-slate-600 dark:text-slate-300">
                Demo accounts use password <span className="font-black">demo-password</span>: student@example.com, instructor@example.com,
                admin@example.com, batoul@example.com.
              </div>
            </DashboardCard>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}

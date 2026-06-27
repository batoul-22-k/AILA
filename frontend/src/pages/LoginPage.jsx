import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { AilaIcon, AilaLogo } from "../components/AilaLogo";
import { Button } from "../components/Button";
import { useToast } from "../components/ToastProvider";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";

function LoginField({ label, icon: Icon, error, rightControl, labelAction, className = "", ...props }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-[#172B36]">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        {labelAction}
      </span>
      <span
        className={`focus-within:border-[#2B7A84] focus-within:ring-2 focus-within:ring-[#2B7A84]/15 flex h-12 items-center gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition ${error ? "border-[#D96A62]" : ""}`}
      >
        <Icon size={17} className="shrink-0 text-[#64748B]" />
        <input
          className={`min-w-0 flex-1 bg-transparent text-sm text-[#172B36] outline-none placeholder:text-[#94A3B8] ${className}`}
          {...props}
        />
        {rightControl}
      </span>
      {error && <span className="text-xs font-medium text-[#C6534C]">{error}</span>}
    </label>
  );
}

function accountRoleFromAuth(auth) {
  const userId = auth?.user?.user_id || "";
  if (userId.startsWith("admin_")) return "admin";
  if (userId.startsWith("instructor_")) return "instructor";
  if (userId.startsWith("student_")) return "student";
  return auth?.user?.account_role || auth?.workspaces?.[0]?.type || "student";
}

function roleWorkspace(auth, role) {
  return auth.workspaces.find((workspace) => workspace.type === role) || { type: role };
}

export function LoginPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { selectWorkspace, clearWorkspace } = useCurrentWorkspace();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = "Email is required.";
    if (!password) nextErrors.password = "Password is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      const auth = await login({ email, password });
      clearWorkspace();
      const accountRole = accountRoleFromAuth(auth);
      if (accountRole === "admin" || accountRole === "instructor") {
        selectWorkspace(roleWorkspace(auth, accountRole));
        navigate(`/${accountRole}`, { replace: true });
      } else if (auth.workspaces.length === 1) {
        selectWorkspace(auth.workspaces[0]);
        navigate(`/${auth.workspaces[0].type}`, { replace: true });
      } else {
        navigate("/workspace-select", { replace: true });
      }
    } catch (err) {
      showToast({ title: "Invalid email or password.", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout data-theme="staff" data-role="instructor">
      <main className="min-h-screen overflow-hidden bg-[#F7FAFA] text-[#172B36]">
        <div className="relative grid min-h-screen place-items-center px-5 py-10 sm:px-8">
          <div className="aila-login-gradient absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(43,122,132,0.16),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(114,183,162,0.18),transparent_30%),radial-gradient(circle_at_50%_86%,rgba(43,122,132,0.12),transparent_36%),linear-gradient(135deg,#F7FAFA_0%,#EEF7F5_52%,#F8FBFB_100%)]" />
          <div className="aila-login-float absolute left-[8%] top-[14%] h-40 w-40 rounded-full bg-[#72B7A2]/16 blur-3xl" />
          <div className="aila-login-float-slow absolute right-[12%] top-[18%] h-56 w-56 rounded-full bg-[#2B7A84]/12 blur-3xl" />
          <div className="aila-login-glow absolute bottom-[12%] left-[28%] h-64 w-64 rounded-full bg-white/65 blur-3xl" />
          <div className="aila-login-float-slow absolute bottom-[16%] right-[20%] h-28 w-28 rounded-[32px] border border-white/55 bg-white/24 shadow-[0_24px_70px_rgba(43,122,132,0.08)] backdrop-blur-xl" />

          <section className="relative w-full max-w-[440px] rounded-[24px] border border-white/70 bg-white/68 p-8 shadow-[0_20px_58px_rgba(23,43,54,0.09)] backdrop-blur-xl">
            <div className="text-center">
              <div className="inline-flex items-center justify-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/70 bg-white/75 shadow-sm">
                  <AilaIcon className="h-7 w-7" />
                </span>
                <AilaLogo className="w-24" />
              </div>
              <h1 className="mt-8 text-2xl font-semibold tracking-tight text-[#172B36]">Welcome back!</h1>
              <p className="mt-1 text-sm font-medium text-[#64748B]">Sign in to continue.</p>
            </div>

            <form className="mt-7 grid gap-4" onSubmit={handleSubmit} noValidate>
              <LoginField
                label="Email"
                icon={Mail}
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrors((current) => ({ ...current, email: "" }));
                }}
                autoComplete="email"
                placeholder="you@example.com"
                error={errors.email}
              />

              <LoginField
                label="Password"
                icon={Lock}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrors((current) => ({ ...current, password: "" }));
                }}
                autoComplete="current-password"
                placeholder="Enter password"
                error={errors.password}
                labelAction={
                  <button type="button" className="text-xs font-semibold text-[#2B7A84] transition hover:text-[#245F68]">
                    Forgot Password?
                  </button>
                }
                rightControl={
                  <button
                    type="button"
                    className="focus-ring rounded-lg p-1 text-[#64748B] transition hover:bg-white/80 hover:text-[#2B7A84]"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                }
              />

              <Button
                type="submit"
                size="lg"
                variant="role"
                loading={loading}
                disabled={loading}
                className="mt-2 h-12 w-full rounded-2xl bg-[#2B7A84] shadow-[0_12px_26px_rgba(43,122,132,0.20)] transition duration-200 hover:scale-[1.01] hover:shadow-[0_16px_34px_rgba(43,122,132,0.26)]"
              >
                {loading ? "Logging in..." : "Log in"}
              </Button>
            </form>
          </section>
        </div>
      </main>
    </AppLayout>
  );
}

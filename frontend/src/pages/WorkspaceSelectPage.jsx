import { ArrowRight, Bell, Building2, ChevronDown, LogOut, RefreshCw, Settings, UserRound, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { AilaLogo } from "../components/AilaLogo";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { DashboardCard } from "../components/DashboardCard";
import { Modal } from "../components/Modal";
import { useToast } from "../components/ToastProvider";
import { getRoleThemeScope, roleMeta } from "../navigation";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";
import { cn } from "../utils/cn";

const copy = {
  student: "Friendly live participation space",
  instructor: "Focused class workflow and question generation",
  admin: "Institution-wide monitoring and reports",
};

const workspaceVars = {
  ...roleMeta.instructor.palette.vars,
  "--role-bg": "#F6F8F7",
  "--role-soft": "#EAF8F0",
  "--role-hover": "#F8FAF8",
  "--role-card-shadow": "0 18px 45px rgba(15, 23, 42, 0.08)",
};

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "S";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatActivity(value) {
  if (!value) return "No activity yet";
  return `Last activity ${formatDate(value)}`;
}

function inferAccountRole(user, workspaces) {
  if (user?.user_id?.startsWith("admin_")) return "admin";
  if (user?.user_id?.startsWith("instructor_")) return "instructor";
  if (user?.user_id?.startsWith("student_")) return "student";
  if (["student", "instructor", "admin"].includes(user?.account_role)) return user.account_role;
  return workspaces[0]?.type ?? "student";
}

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, workspaces, logout, refreshSession } = useAuth();
  const { selectWorkspace, clearWorkspace } = useCurrentWorkspace();
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const accountMenuRef = useRef(null);
  const accountRole = inferAccountRole(user, workspaces);
  const isStudentAccount = accountRole === "student";
  const roleLabel = roleMeta[accountRole]?.label ?? "Student";
  const activeRole = isStudentAccount ? "student" : workspaces[0]?.type ?? accountRole;
  const visibleWorkspaces = useMemo(() => {
    if (workspaces.length > 0) return workspaces;
    if (accountRole === "instructor") return [{ type: "instructor", label: "Instructor Workspace" }];
    if (accountRole === "admin") return [{ type: "admin", label: "Institution Administration" }];
    return [];
  }, [accountRole, workspaces]);
  const studentWorkspaces = workspaces.filter((workspace) => workspace.type === "student");
  const hasStudentClasses = studentWorkspaces.length > 0;
  const userName = user?.name ?? roleMeta[activeRole]?.name ?? "Student";
  const userEmail = user?.email ?? "";
  const profileStats = [
    ["Classes Joined", studentWorkspaces.length],
    ["Sessions Attended", user?.sessions_attended ?? 0],
    ["Questions Answered", user?.questions_answered ?? 0],
  ];

  useEffect(() => {
    if (!isStudentAccount && visibleWorkspaces.length === 1) {
      selectWorkspace(visibleWorkspaces[0]);
      navigate(`/${visibleWorkspaces[0].type}`, { replace: true });
    }
  }, [isStudentAccount, navigate, selectWorkspace, visibleWorkspaces]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setProfileOpen(false);
        setSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleSelect(workspace) {
    selectWorkspace(workspace);
    navigate(`/${workspace.type}`, { replace: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshSession();
      showToast({ title: "Enrollments refreshed", description: "Your institution-managed class list is up to date.", tone: "success" });
    } catch (err) {
      showToast({ title: "Could not refresh", description: err instanceof Error ? err.message : "Could not refresh enrollments", tone: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  function handleLogout() {
    setAccountOpen(false);
    clearWorkspace();
    logout();
    window.localStorage.removeItem("activeSession");
    window.localStorage.removeItem("activeQuestionId");
    window.localStorage.removeItem("selectedAnswer");
    Object.keys(window.localStorage).forEach((key) => {
      if (key.startsWith("activeQuestionId:") || key.startsWith("selectedAnswer:")) window.localStorage.removeItem(key);
    });
    navigate("/login", { replace: true });
  }

  return (
    <AppLayout data-theme={getRoleThemeScope("instructor")} data-role="instructor" style={workspaceVars}>
      <main className="min-h-screen bg-[#F6F8F7] px-4 py-5 text-slate-950 dark:bg-slate-950 sm:px-6 lg:px-8">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-[24px] bg-white px-5 py-3 shadow-soft dark:bg-slate-900">
              <AilaLogo className="w-28 text-[var(--role-text)]" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-black text-slate-950 dark:text-white">{roleLabel} workspace</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {isStudentAccount ? "Access is managed by your instructor" : "Choose where you want to work"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" aria-label="Notifications" title="Notifications">
              <Bell size={17} />
            </Button>
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                className="focus-ring flex items-center gap-3 rounded-full border border-role-border bg-white px-3 py-2 text-left shadow-soft transition hover:border-role-primary dark:border-slate-800 dark:bg-slate-900"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#2B7886] text-sm font-black text-white">
                  {initials(userName)}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-sm font-black text-slate-950 dark:text-white">{userName}</span>
                  <Badge tone={roleMeta[accountRole]?.tone ?? "green"}>{roleLabel}</Badge>
                </span>
                <ChevronDown className={cn("text-slate-400 transition", accountOpen && "rotate-180")} size={16} />
              </button>

              {accountOpen && (
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-[24px] border border-role-border bg-white p-2 shadow-lift dark:border-slate-800 dark:bg-slate-900" role="menu">
                  <div className="flex items-center gap-3 border-b border-role-border px-3 py-3 dark:border-slate-800">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2B7886] text-sm font-black text-white">
                      {initials(userName)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950 dark:text-white">{userName}</p>
                      <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{userEmail || `${roleLabel} account`}</p>
                    </div>
                  </div>

                  <button className="mt-2 flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200" type="button" role="menuitem" onClick={() => { setAccountOpen(false); setProfileOpen(true); }}>
                    <UserRound size={17} />
                    Profile
                  </button>
                  <button className="flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200" type="button" role="menuitem" onClick={() => { setAccountOpen(false); setSettingsOpen(true); }}>
                    <Settings size={17} />
                    Settings
                  </button>
                  <button className="mt-2 flex w-full items-center gap-3 rounded-[18px] border-t border-role-border px-3 py-2.5 text-left text-sm font-bold text-red-600 hover:bg-red-50 dark:border-slate-800 dark:text-red-200 dark:hover:bg-red-400/10" type="button" role="menuitem" onClick={handleLogout}>
                    <LogOut size={17} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl content-center gap-6 py-8">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Badge tone="teal">Institution managed</Badge>
              <h1 className="mt-4 max-w-xl text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl">
                Your classes will appear here.
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-slate-600 dark:text-slate-300">
                Students are enrolled by the institution administrator or institution sync. When your enrollment is updated, refresh this page and enter your workspace.
              </p>
            </div>

            {refreshing && (
              <div className="grid gap-3">
                {[0, 1].map((item) => (
                  <div key={item} className="h-44 animate-pulse rounded-[28px] bg-white shadow-soft dark:bg-slate-900" />
                ))}
              </div>
            )}

            {!refreshing && isStudentAccount && !hasStudentClasses && (
              <DashboardCard className="border-role-border bg-white shadow-lift dark:bg-slate-900">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-[28px] bg-role-soft text-role-primary">
                    <UsersRound size={34} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-2xl font-black text-slate-950 dark:text-white">You are not enrolled in any class yet</h2>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      An institution administrator must add your account to a class before you can participate.
                    </p>
                    <div className="mt-5 rounded-[22px] bg-role-hover p-4 text-sm leading-6 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
                      If you expected a class here, ask your institution administrator to enroll <span className="font-black text-slate-900 dark:text-white">{userEmail || userName}</span>, then refresh.
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <Button type="button" size="lg" variant="role" loading={refreshing} onClick={handleRefresh}>
                        <RefreshCw size={18} />
                        Refresh enrollments
                      </Button>
                      <Button type="button" size="lg" variant="outline" onClick={() => setProfileOpen(true)}>
                        <UserRound size={18} />
                        View profile
                      </Button>
                    </div>
                  </div>
                </div>
              </DashboardCard>
            )}

            {!refreshing && hasStudentClasses && (
              <div className="grid gap-4">
                {studentWorkspaces.map((workspace) => (
                  <DashboardCard key={`${workspace.type}-${workspace.class_id}`} interactive className="bg-white shadow-soft dark:bg-slate-900">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-4">
                        <span className="grid h-12 w-12 place-items-center rounded-[20px] bg-[#2B7886] text-white shadow-soft">
                          <Building2 size={23} />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label}</h2>
                            <Badge tone="green">Student</Badge>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            Instructor: {workspace.instructor_name || "To be announced"}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{formatActivity(workspace.last_activity_at)}</p>
                        </div>
                      </div>
                      <Button type="button" variant="role" onClick={() => handleSelect(workspace)}>
                        Enter class
                        <ArrowRight size={16} />
                      </Button>
                    </div>
                  </DashboardCard>
                ))}
              </div>
            )}

            {!refreshing && !isStudentAccount && (
              <div className="grid gap-4">
                {visibleWorkspaces.map((workspace) => {
                  const meta = roleMeta[workspace.type];
                  const Icon = meta.icon;
                  const palette = meta.palette;
                  return (
                    <DashboardCard
                      key={`${workspace.type}-${workspace.class_id ?? "global"}`}
                      interactive
                      data-theme={getRoleThemeScope(workspace.type)}
                      data-role={workspace.type}
                      style={palette.vars}
                    >
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-4">
                          <span className={cn("grid h-12 w-12 place-items-center rounded-[20px] bg-gradient-to-br text-white shadow-soft", palette.gradient)}>
                            <Icon size={23} />
                          </span>
                          <div>
                            <h2 className="text-xl font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label}</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy[workspace.type]}</p>
                          </div>
                        </div>
                        <Button type="button" variant="role" onClick={() => handleSelect(workspace)}>
                          Enter workspace
                          <ArrowRight size={16} />
                        </Button>
                      </div>
                    </DashboardCard>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <Modal open={profileOpen} title="Profile" onClose={() => setProfileOpen(false)}>
          <div className="overflow-hidden rounded-[24px] border border-role-border bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-4 border-b border-role-border p-5 dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate text-xl font-black text-slate-950 dark:text-white">{userName}</p>
                <Badge className="mt-2" tone={roleMeta[accountRole]?.tone ?? "green"}>{roleLabel}</Badge>
                <p className="mt-3 font-mono text-sm font-bold text-slate-500 dark:text-slate-400">{user?.user_id ?? "Not available"}</p>
              </div>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#2B7886] text-sm font-black text-white">
                {initials(userName)}
              </span>
            </div>

            <div className="border-b border-role-border p-5 dark:border-slate-800">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Email</p>
              <p className="mt-2 break-words text-sm font-bold text-slate-700 dark:text-slate-200">{userEmail || "Not available"}</p>
            </div>

            <div className="border-b border-role-border p-5 dark:border-slate-800">
              <div className="grid gap-3">
                {profileStats.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-bold text-slate-500 dark:text-slate-400">{label}</span>
                    <span className="font-black text-slate-950 dark:text-white">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid p-2">
              <button className="flex items-center gap-3 rounded-[18px] px-3 py-3 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200" type="button" onClick={() => { setProfileOpen(false); setSettingsOpen(true); }}>
                <Settings size={17} />
                Settings
              </button>
              <button className="flex items-center gap-3 rounded-[18px] px-3 py-3 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200" type="button" onClick={() => showToast({ title: "Change password", description: "Password management is not connected yet.", tone: "info" })}>
                <UserRound size={17} />
                Change Password
              </button>
              <button className="flex items-center gap-3 rounded-[18px] px-3 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-400/10" type="button" onClick={handleLogout}>
                <LogOut size={17} />
                Logout
              </button>
            </div>
          </div>
        </Modal>

        <Modal open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}>
          <div className="flex items-center justify-between gap-4 rounded-[22px] bg-role-hover p-4 dark:bg-slate-950/40">
            <div>
              <p className="font-black text-slate-950 dark:text-white">Appearance</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The workspace uses the light AILA theme.</p>
            </div>
          </div>
        </Modal>
      </main>
    </AppLayout>
  );
}

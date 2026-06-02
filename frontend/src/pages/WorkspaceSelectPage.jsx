import { ArrowRight, Building2 } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { AppLayout } from "../components/AppLayout";
import { AilaLogo } from "../components/AilaLogo";
import { Button } from "../components/Button";
import { DashboardCard } from "../components/DashboardCard";
import { ThemeToggle } from "../components/ThemeToggle";
import { getRoleThemeScope, roleMeta } from "../navigation";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";
import { cn } from "../utils/cn";

const copy = {
  student: "Friendly live participation space",
  instructor: "Focused class workflow and question generation",
  admin: "Institution-wide monitoring and reports",
};

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { user, workspaces } = useAuth();
  const { selectWorkspace } = useCurrentWorkspace();
  const activeRole = workspaces[0]?.type ?? "instructor";
  const activePalette = roleMeta[activeRole].palette;

  useEffect(() => {
    if (workspaces.length === 1) {
      selectWorkspace(workspaces[0]);
      navigate(`/${workspaces[0].type}`, { replace: true });
    }
  }, [navigate, selectWorkspace, workspaces]);

  function handleSelect(workspace) {
    selectWorkspace(workspace);
    navigate(`/${workspace.type}`, { replace: true });
  }

  return (
    <AppLayout data-theme={getRoleThemeScope(activeRole)} data-role={activeRole} style={activePalette.vars}>
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <header className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <AilaLogo className="w-28 text-[var(--role-text)]" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Signed in as {user?.name}</p>
          </div>
          <ThemeToggle />
        </header>

        <section className="mx-auto grid max-w-6xl gap-5 py-10">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-role-accent">Choose workspace</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Where are you working today?</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Your account can have different roles in different classes. Pick the class context before entering the portal.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {workspaces.map((workspace) => {
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
                  className={cn(workspace.type === "student" && "bg-[var(--role-primary)]", workspace.type === "admin" && "border-slate-300")}
                >
                  <div className="flex min-h-56 flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn("grid h-12 w-12 place-items-center rounded-[var(--role-radius)] bg-gradient-to-br text-white shadow-soft", palette.gradient)}>
                        <Icon size={23} />
                      </span>
                      <span className="rounded-full bg-[var(--role-soft)] px-2.5 py-1 text-[11px] font-black text-[var(--role-text)]">
                        {meta.label}
                      </span>
                    </div>
                    <h2 className="mt-5 text-xl font-black text-slate-950 dark:text-white">{workspace.class_name ?? workspace.label}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy[workspace.type]}</p>
                    <Button className="mt-auto w-full" type="button" variant="role" onClick={() => handleSelect(workspace)}>
                      <Building2 size={16} />
                      Enter workspace
                      <ArrowRight size={16} />
                    </Button>
                  </div>
                </DashboardCard>
              );
            })}
          </div>
        </section>
      </main>
    </AppLayout>
  );
}

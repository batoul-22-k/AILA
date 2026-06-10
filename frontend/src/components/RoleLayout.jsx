import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { getRoleThemeScope, navigation, roleMeta } from "../navigation";
import { useAppAppearance } from "../state/InstructorAppearanceContext";
import { cn } from "../utils/cn";
import { AppLayout } from "./AppLayout";
import { AilaIcon, AilaLogo } from "./AilaLogo";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function RoleLayout({ role }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const meta = roleMeta[role];
  const palette = meta.palette;
  const themeScope = getRoleThemeScope(role);
  const appAppearance = useAppAppearance();
  const staffAppearanceProps = {
    "data-app-theme": appAppearance.palette,
    "data-instructor-theme": appAppearance.palette,
    "data-density": appAppearance.density,
    "data-layout-style": appAppearance.layout,
    "data-motion": appAppearance.motion,
    "data-accessibility": appAppearance.accessibility,
    style: appAppearance.cssVars,
  };
  const appearanceProps = staffAppearanceProps;

  return (
    <AppLayout data-theme={themeScope} data-role={role} {...appearanceProps}>
      <div className="role-shell flex">
        <Sidebar role={role} />

        <div className="min-w-0 flex-1">
          <Topbar role={role} onMenuClick={() => setDrawerOpen(true)} />
          {appAppearance.layout === "top-navigation" && (
            <nav className="role-topnav hidden border-b border-[var(--role-border)] bg-[var(--role-surface)]/80 px-8 py-3 lg:flex">
              <div className="mx-auto flex w-full max-w-[88rem] items-center gap-1">
                {navigation[role].map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "focus-ring inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all",
                          isActive ? palette.active : "text-[var(--color-muted)] hover:bg-role-hover hover:text-[var(--role-text)]",
                        )
                      }
                    >
                      <ItemIcon size={16} />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </nav>
          )}

          <main className="role-main mx-auto w-full px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/40" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />
          <aside className="role-drawer relative h-full w-80 max-w-[86vw] bg-white p-4 shadow-lift dark:bg-slate-950">
            <div className="role-brand-card flex items-center gap-3 border p-3 dark:bg-slate-900">
              <span className={cn("grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br text-white", palette.gradient)}>
                <AilaIcon className="h-7 w-7" />
              </span>
              <div>
                <AilaLogo className="w-24 text-[var(--role-text)]" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.workspace}</p>
              </div>
            </div>
            <nav className="mt-6 grid gap-1">
              {navigation[role].map((item) => {
                const ItemIcon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-full px-3 py-3 text-sm font-bold transition-all duration-300",
                        isActive
                          ? palette.active
                          : "text-slate-600 dark:text-slate-300",
                      )
                    }
                  >
                    <ItemIcon size={18} />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

    </AppLayout>
  );
}

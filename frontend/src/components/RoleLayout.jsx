import { Fragment, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { getRoleThemeScope, navigation, roleMeta } from "../navigation";
import { useAppAppearance } from "../state/InstructorAppearanceContext";
import { cn } from "../utils/cn";
import { AppLayout } from "./AppLayout";
import { AilaIcon, AilaLogo } from "./AilaLogo";
import { PageTransition } from "./layout/PageTransition";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function RoleLayout({ role }) {
  const location = useLocation();
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

  useEffect(() => {
    if (!drawerOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <AppLayout data-theme={themeScope} data-role={role} {...appearanceProps}>
      <div className="role-shell min-h-screen">
        <Sidebar role={role} />

        <div className="role-content min-w-0">
          <Topbar role={role} onMenuClick={() => setDrawerOpen(true)} />
          {appAppearance.layout === "top-navigation" && (
            <nav className="role-topnav hidden border-b border-[var(--role-border)] bg-[var(--role-surface)]/80 px-8 py-3 lg:flex">
              <div className="mx-auto flex w-full max-w-[88rem] items-center gap-1">
                {navigation[role].map((item) => {
                  const ItemIcon = item.icon;
                  const forceActive = item.matchPrefix && location.pathname.startsWith(item.matchPrefix);
                  return (
                    <Fragment key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            "focus-ring inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all",
                            isActive || forceActive ? palette.active : "text-[var(--color-muted)] hover:bg-role-hover hover:text-[var(--role-text)]",
                            item.strike && "opacity-55",
                          )
                        }
                      >
                        <ItemIcon size={16} />
                        <span className={cn(item.strike && "text-slate-400 line-through decoration-2")}>{item.label}</span>
                      </NavLink>
                      {item.children && forceActive && item.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end={child.end}
                            className={({ isActive }) =>
                              cn(
                                "focus-ring inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black transition-all",
                                isActive ? "bg-role-hover text-role-primary shadow-sm" : "text-[var(--color-muted)] hover:bg-role-hover hover:text-[var(--role-text)]",
                              )
                            }
                          >
                            <ChildIcon size={14} />
                            {child.label}
                          </NavLink>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </nav>
          )}

          <main className="role-main mx-auto w-full px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/40" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />
          <aside className="role-drawer subtle-scroll relative flex h-full w-80 max-w-[86vw] flex-col overflow-y-auto bg-white p-4 shadow-lift dark:bg-slate-950">
            <div className="role-brand-card flex items-center gap-3 border p-2.5 dark:bg-slate-900">
              <span className={cn("grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br text-white", palette.gradient)}>
                <AilaIcon className="h-7 w-7" />
              </span>
              <div>
                <AilaLogo className="w-24 text-[var(--role-text)]" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.workspace}</p>
              </div>
            </div>
            <nav className="mt-4 grid gap-1">
              {navigation[role].map((item) => {
                const ItemIcon = item.icon;
                const forceActive = item.matchPrefix && location.pathname.startsWith(item.matchPrefix);
                return (
                  <div key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setDrawerOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex min-h-10 items-center gap-3 rounded-full px-3 py-2.5 text-sm font-bold transition-all duration-300",
                          isActive || forceActive
                            ? palette.active
                            : "text-slate-600 dark:text-slate-300",
                          item.strike && "opacity-55",
                        )
                      }
                    >
                      <ItemIcon className="shrink-0" size={17} />
                      <span className={cn(item.strike && "text-slate-400 line-through decoration-2")}>{item.label}</span>
                    </NavLink>
                    {item.children && forceActive && (
                      <div className="ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <NavLink
                              key={child.to}
                              to={child.to}
                              end={child.end}
                              onClick={() => setDrawerOpen(false)}
                              className={({ isActive }) =>
                                cn(
                                  "flex min-h-9 items-center gap-2 rounded-full px-3 py-2 text-xs font-black transition",
                                  isActive ? "bg-role-hover text-role-primary shadow-sm" : "text-slate-500 dark:text-slate-300",
                                )
                              }
                            >
                              <ChildIcon size={14} />
                              {child.label}
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

    </AppLayout>
  );
}

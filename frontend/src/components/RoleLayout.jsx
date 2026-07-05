import { Fragment, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { getRoleThemeScope, navigation, roleMeta } from "../navigation";
import { useAppAppearance } from "../state/InstructorAppearanceContext";
import { cn } from "../utils/cn";
import { AppLayout } from "./AppLayout";
import { PageTransition } from "./layout/PageTransition";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function RoleLayout({ role }) {
  const location = useLocation();
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem("sidebarPinned") === "true");
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const collapseTimerRef = useRef(null);
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
  const showTopNavigation = false;

  useEffect(() => {
    localStorage.setItem("sidebarPinned", String(sidebarPinned));
  }, [sidebarPinned]);

  useEffect(() => {
    function handleShortcut(event) {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarPinned((current) => !current);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    };
  }, []);

  function handleSidebarEnter() {
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    setSidebarHovered(true);
  }

  function handleSidebarLeave() {
    if (sidebarPinned) return;
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(() => setSidebarHovered(false), 150);
  }

  function toggleSidebarPinned() {
    setSidebarPinned((current) => !current);
  }

  const sidebarExpanded = sidebarPinned || sidebarHovered;

  return (
    <AppLayout data-theme={themeScope} data-role={role} {...appearanceProps}>
      <div
        className="role-shell min-h-screen"
        data-sidebar-expanded={sidebarExpanded ? "true" : "false"}
        data-sidebar-pinned={sidebarPinned ? "true" : "false"}
      >
        <Sidebar
          role={role}
          expanded={sidebarExpanded}
          pinned={sidebarPinned}
          onMouseEnter={handleSidebarEnter}
          onMouseLeave={handleSidebarLeave}
          onPinToggle={toggleSidebarPinned}
        />
        {!sidebarPinned && <div className="role-sidebar-edge-trigger hidden md:block" onMouseEnter={handleSidebarEnter} aria-hidden="true" />}

        <div className="role-content min-w-0">
          <Topbar role={role} />
          {showTopNavigation && appAppearance.layout === "top-navigation" && (
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
      <MobileBottomNav role={role} />

    </AppLayout>
  );
}

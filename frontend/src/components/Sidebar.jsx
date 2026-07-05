import { CheckCircle2, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { listClasses } from "../api/client";
import { navigation, roleMeta } from "../navigation";
import { cn } from "../utils/cn";
import { AilaIcon, AilaLogo } from "./AilaLogo";

const studioSteps = [
  { id: "upload", label: "Upload" },
  { id: "generate", label: "Generate" },
  { id: "review", label: "Review" },
  { id: "ready", label: "Ready" },
];

function getStoredStudioStage() {
  return localStorage.getItem("contentStudio:activeStage") || "upload";
}

export function Sidebar({ role, expanded = false, pinned = false, onMouseEnter, onMouseLeave, onPinToggle }) {
  const location = useLocation();
  const meta = roleMeta[role];
  const palette = meta.palette;
  const collapsed = !expanded;
  const [classes, setClasses] = useState([]);
  const [studioStage, setStudioStage] = useState(getStoredStudioStage);
  const showClassSubnav = role === "instructor" && location.pathname.startsWith("/instructor/classes");
  const showStudioSubnav = role === "instructor" && location.pathname.startsWith("/instructor/content-studio");
  const activeStageIndex = Math.max(0, studioSteps.findIndex((step) => step.id === studioStage));

  async function loadInstructorClasses() {
    if (role !== "instructor") return;
    try {
      const result = await listClasses();
      setClasses(result.filter((classDoc) => classDoc.status?.toLowerCase() !== "inactive"));
    } catch {
      setClasses([]);
    }
  }

  useEffect(() => {
    void loadInstructorClasses();
  }, [role, location.pathname]);

  useEffect(() => {
    function handleClassesChanged() {
      void loadInstructorClasses();
    }

    window.addEventListener("instructor-classes-changed", handleClassesChanged);
    return () => {
      window.removeEventListener("instructor-classes-changed", handleClassesChanged);
    };
  }, [role]);

  useEffect(() => {
    function handleStageChange(event) {
      setStudioStage(event.detail?.stage || getStoredStudioStage());
    }

    function handleStorage(event) {
      if (event.key === "contentStudio:activeStage") setStudioStage(getStoredStudioStage());
    }

    window.addEventListener("content-studio-stage", handleStageChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("content-studio-stage", handleStageChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
    <aside
      className="role-sidebar fixed left-4 top-4 z-20 hidden h-[calc(100vh-32px)] shrink-0 md:block"
      aria-label={`${meta.label} navigation`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex h-full flex-col">
        <button
          className="role-brand-card focus-ring flex w-full cursor-pointer items-center gap-2.5 border p-2.5 text-left backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80"
          type="button"
          onClick={onPinToggle}
          aria-label={pinned ? "Collapse navigation" : "Pin navigation"}
          aria-pressed={pinned}
          title={pinned ? "Collapse navigation" : "Pin navigation"}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-soft">
            <AilaIcon className="h-7 w-7" />
          </span>
          <div className="role-brand-details min-w-0">
            <AilaLogo className="w-20 text-[var(--role-text)]" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.workspace}</p>
          </div>
        </button>

        <nav className="subtle-scroll mt-4 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
          <p className="role-sidebar-section-title px-3 pb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">Navigation</p>
          {navigation[role].map((item) => {
            const ItemIcon = item.icon;
            const forceActive = (item.to === "/instructor/analytics" && location.pathname.startsWith("/instructor/at-risk"))
              || (item.matchPrefix && location.pathname.startsWith(item.matchPrefix));
            return (
              <div key={item.to} className="role-nav-group group relative">
                <NavLink
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  aria-disabled={item.strike ? "true" : undefined}
                  className={({ isActive }) =>
                    cn(
                      "group flex min-h-10 items-center gap-3 rounded-full px-3 py-2.5 text-sm font-bold transition-all duration-300",
                      isActive || forceActive
                        ? cn("role-nav-active", palette.active)
                        : "text-slate-600 hover:bg-role-hover hover:text-role-text dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white",
                      item.strike && "role-nav-disabled opacity-55 hover:bg-transparent hover:text-slate-500 dark:hover:text-slate-400",
                    )
                  }
                >
                  <span className="role-active-indicator" aria-hidden="true" />
                  <ItemIcon className="shrink-0" size={17} />
                  <span className={cn("role-nav-label truncate", item.strike && "text-slate-400 line-through decoration-2")}>{item.label}</span>
                </NavLink>
                {collapsed && !item.children && (
                  <span className="role-nav-tooltip pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-black text-white opacity-0 shadow-lift transition group-hover:opacity-100 dark:bg-white dark:text-slate-950">
                    {item.label}
                  </span>
                )}

                {item.children && forceActive && (
                  <div className="role-nav-children ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end={child.end}
                          className={({ isActive }) =>
                            cn(
                              "focus-ring flex min-h-9 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition",
                              isActive
                                ? "border-role-primary bg-role-hover text-role-primary shadow-sm"
                                : "border-transparent text-slate-500 hover:bg-role-hover hover:text-role-primary dark:text-slate-300",
                            )
                          }
                        >
                          <ChildIcon size={14} />
                          <span className="truncate">{child.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}

                {item.children && collapsed && (
                  <div className="role-nav-flyout pointer-events-none absolute left-[calc(100%+0.75rem)] top-0 z-50 min-w-56 translate-x-1 rounded-2xl border border-role-border bg-white p-2 opacity-0 shadow-lift transition dark:border-slate-800 dark:bg-slate-900">
                    <p className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-role-primary">{item.label}</p>
                    <div className="grid gap-1">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        return (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end={child.end}
                            className={({ isActive }) =>
                              cn(
                                "focus-ring flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-black transition",
                                isActive
                                  ? "bg-role-hover text-role-primary shadow-sm"
                                  : "text-slate-600 hover:bg-role-hover hover:text-role-primary dark:text-slate-300",
                              )
                            }
                          >
                            <ChildIcon size={15} />
                            <span>{child.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                )}

                {item.to === "/instructor/classes" && showClassSubnav && (
                  <div className="role-nav-children ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
                    {classes.length === 0 && <p className="px-3 py-2 text-xs font-bold text-slate-400">No active classes</p>}
                    {classes.map((classDoc) => (
                      <NavLink
                        key={classDoc.class_id}
                        to={`/instructor/classes/${classDoc.class_id}`}
                        end
                        className={({ isActive }) =>
                          cn(
                            "focus-ring flex min-h-9 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition",
                            isActive
                              ? "border-role-primary bg-role-hover text-role-primary shadow-sm"
                              : "border-transparent text-slate-500 hover:bg-role-hover hover:text-role-primary dark:text-slate-300",
                          )
                        }
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                        <span className="truncate">{classDoc.name}</span>
                      </NavLink>
                    ))}
                  </div>
                )}

                {item.to === "/instructor/content-studio" && showStudioSubnav && (
                  <div className="role-nav-children ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
                    {studioSteps.map((step, index) => {
                      const complete = index < activeStageIndex;
                      const active = index === activeStageIndex;
                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "flex min-h-9 items-center gap-2 rounded-full px-3 py-2 text-xs font-black",
                            active && "bg-role-primary text-white shadow-soft",
                            complete && !active && "bg-emerald-50 text-emerald-700",
                            !active && !complete && "text-slate-500 dark:text-slate-300",
                          )}
                        >
                          {complete ? <CheckCircle2 size={14} /> : <Circle size={active ? 14 : 12} />}
                          <span className="truncate">{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

       {/*  <div className={cn("mt-auto rounded-[var(--role-radius)] bg-gradient-to-br p-4 text-white shadow-soft", palette.gradient)}>
          <p className="text-sm font-black">{meta.label} focus</p>
          <p className="mt-1 text-xs leading-5 text-white/85">{meta.focus}</p>
        </div> */}
      </div>
    </aside>
  );
}

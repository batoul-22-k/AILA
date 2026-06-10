import { AlertTriangle, BarChart3, CheckCircle2, Circle, Sparkles } from "lucide-react";
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

export function Sidebar({ role }) {
  const location = useLocation();
  const meta = roleMeta[role];
  const palette = meta.palette;
  const [classes, setClasses] = useState([]);
  const [studioStage, setStudioStage] = useState(getStoredStudioStage);
  const showClassSubnav = role === "instructor" && location.pathname.startsWith("/instructor/classes");
  const showStudioSubnav = role === "instructor" && location.pathname.startsWith("/instructor/content-studio");
  const showAnalyticsSubnav = role === "instructor" && (location.pathname.startsWith("/instructor/analytics") || location.pathname.startsWith("/instructor/at-risk"));
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
    <aside className="role-sidebar sticky top-0 hidden h-screen shrink-0 p-4 lg:block">
      <div className="flex h-full flex-col">
        <div className="role-brand-card flex items-center gap-3 border p-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
          <span className={"grid h-12 w-12 place-items-center rounded-full shadow-soft"}>
            <AilaIcon className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <AilaLogo className="w-24 text-[var(--role-text)]" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{meta.workspace}</p>
          </div>
        </div>

        <nav className="subtle-scroll mt-6 grid gap-1.5 overflow-y-auto">
          {navigation[role].map((item) => {
            const ItemIcon = item.icon;
            const forceActive = item.to === "/instructor/analytics" && location.pathname.startsWith("/instructor/at-risk");
            return (
              <div key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-full px-3 py-3 text-sm font-bold transition-all duration-300",
                      isActive || forceActive
                        ? palette.active
                        : "text-slate-600 hover:bg-role-hover hover:text-role-text dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white",
                    )
                  }
                >
                  <ItemIcon size={18} />
                  <span className="role-nav-label">{item.label}</span>
                </NavLink>

                {item.to === "/instructor/classes" && showClassSubnav && (
                  <div className="ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
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
                  <div className="ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
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
                          {complete ? <CheckCircle2 size={14} /> : active ? <Sparkles size={14} /> : <Circle size={12} />}
                          <span className="truncate">{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {item.to === "/instructor/analytics" && showAnalyticsSubnav && (
                  <div className="ml-3 mt-2 grid gap-1.5 border-l border-role-border pl-3">
                    <NavLink
                      to="/instructor/analytics"
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
                      <BarChart3 size={14} />
                      <span className="truncate">Overview</span>
                    </NavLink>
                    <NavLink
                      to="/instructor/at-risk"
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
                      <AlertTriangle size={14} />
                      <span className="truncate">At-Risk Students</span>
                    </NavLink>
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

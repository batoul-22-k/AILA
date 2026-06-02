import { Bell, ChevronDown, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { roleMeta } from "../navigation";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";
import { cn } from "../utils/cn";
import { AilaIcon } from "./AilaLogo";
import { Button } from "./Button";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ role, onMenuClick }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const { logout, user, workspaces } = useAuth();
  const { currentWorkspace, clearWorkspace } = useCurrentWorkspace();
  const navigate = useNavigate();
  const meta = roleMeta[role];
  const palette = meta.palette;
  const searchPlaceholder = role === "admin" ? "Search classes, instructors, reports" : "Search sessions, classes, questions";
  const roleWorkspace = currentWorkspace?.type === role ? currentWorkspace : workspaces.find((workspace) => workspace.type === role);
  const displayName = user?.name ?? meta.name;
  const displayEmail = user?.email ?? "";

  useEffect(() => {
    function handlePointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleLogout() {
    setAccountOpen(false);
    clearWorkspace();
    logout();
    navigate("/login");
  }

  return (
    <header className="role-topbar sticky top-0 z-30 border-b backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
      <div className="flex min-h-16 items-center justify-between gap-3 px-3 sm:px-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button className="lg:hidden" variant="ghost" size="sm" type="button" onClick={onMenuClick} aria-label="Open navigation">
            <Menu size={18} />
          </Button>
          <span className={"grid h-10 w-10 place-items-center rounded-full lg:hidden"}>
            <AilaIcon className="h-7 w-7" />
          </span>
          {/* <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-950 dark:text-white sm:text-base">{meta.workspace}</p>
            <p className="hidden text-xs font-semibold text-slate-500 dark:text-slate-400 sm:block">{roleWorkspace?.class_name ?? roleWorkspace?.label ?? meta.focus}</p>
          </div> */}
        </div>

        {role !== "student" && (
          <label className="role-search hidden max-w-sm flex-1 items-center rounded-full border px-4 py-2 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 md:flex">
            <Search size={17} className="text-slate-400" />
            <span className="sr-only">Search</span>
            <input className="ml-2 w-full bg-transparent text-sm outline-none placeholder:text-slate-400" placeholder={searchPlaceholder} />
          </label>
        )}

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" type="button" aria-label="Notifications">
            <Bell size={17} />
          </Button>
          <div ref={accountMenuRef} className="relative">
            <button
              className="role-user-chip focus-ring flex items-center gap-2 rounded-full border px-2 py-2 text-left backdrop-blur-md transition-all hover:bg-role-hover dark:border-slate-800 dark:bg-slate-900/80 sm:gap-3 sm:px-3"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-black text-white", palette.gradient)}>
                {displayName.slice(0, 1)}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-xs font-black text-slate-950 dark:text-white">{displayName}</span>
                <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">{meta.label}</span>
              </span>
              <ChevronDown className={cn("hidden text-slate-400 transition-transform sm:block", accountOpen && "rotate-180")} size={15} />
            </button>

            {accountOpen && (
              <div
                className="absolute right-0 z-50 mt-2 w-72 rounded-[var(--role-radius)] border border-[var(--role-border)] bg-[var(--role-surface)] p-2 shadow-lift dark:border-slate-800 dark:bg-slate-900"
                role="menu"
              >
                <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-3 dark:border-slate-800">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-black text-white", palette.gradient)}>
                    {displayName.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950 dark:text-white">{displayName}</p>
                    <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{displayEmail || meta.label}</p>
                  </div>
                </div>

                <button
                  className="mt-2 flex w-full items-center gap-3 rounded-[var(--role-radius)] px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    navigate(`/${role}/profile`);
                  }}
                >
                  <UserRound size={17} />
                  Edit profile
                </button>
                <button
                  className="flex w-full items-center gap-3 rounded-[var(--role-radius)] px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-role-hover dark:text-slate-200"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    navigate(`/${role}/settings/appearance`);
                  }}
                >
                  <Settings size={17} />
                  Appearance
                </button>
                <button
                  className="mt-2 flex w-full items-center gap-3 rounded-[var(--role-radius)] border-t border-[var(--color-border)] px-3 py-2.5 text-left text-sm font-bold text-red-600 hover:bg-red-50 dark:border-slate-800 dark:text-red-200 dark:hover:bg-red-400/10"
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                >
                  <LogOut size={17} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

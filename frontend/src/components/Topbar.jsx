import { Bell, BookOpen, CheckCheck, ChevronDown, LogOut, Menu, Search, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { listNotifications, markNotificationsRead } from "../api/client";
import { roleMeta } from "../navigation";
import { useAuth } from "../state/AuthContext";
import { useCurrentWorkspace } from "../state/WorkspaceContext";
import { cn } from "../utils/cn";
import { AilaIcon } from "./AilaLogo";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ThemeToggle } from "./ThemeToggle";

function formatNotificationTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const notificationTone = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-role-primary",
};

export function Topbar({ role, onMenuClick }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const accountMenuRef = useRef(null);
  const notificationsRef = useRef(null);
  const { logout, user, workspaces } = useAuth();
  const { currentWorkspace, clearWorkspace, selectWorkspace } = useCurrentWorkspace();
  const navigate = useNavigate();
  const meta = roleMeta[role];
  const palette = meta.palette;
  const searchPlaceholder = role === "admin" ? "Search classes, instructors, reports" : "Search sessions, classes, questions";
  const roleWorkspace = currentWorkspace?.type === role ? currentWorkspace : workspaces.find((workspace) => workspace.type === role);
  const studentClasses = workspaces.filter((workspace) => workspace.type === "student");
  const displayName = user?.name ?? meta.name;
  const displayEmail = user?.email ?? "";
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    function handlePointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      try {
        const result = await listNotifications({ unreadOnly: false });
        if (!cancelled) setNotifications(result);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    }

    void loadNotifications();
    const intervalId = window.setInterval(loadNotifications, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user?.user_id]);

  function handleLogout() {
    setAccountOpen(false);
    clearWorkspace();
    logout();
    navigate("/login");
  }

  async function handleNotificationsToggle() {
    setNotificationsOpen((open) => !open);
    setAccountOpen(false);
    const unreadIds = notifications.filter((notification) => !notification.read).map((notification) => notification.notification_id);
    if (unreadIds.length === 0) return;
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    try {
      await markNotificationsRead(unreadIds);
    } catch {
      // The inbox should stay usable even if read state sync fails.
    }
  }

  async function handleMarkAllRead() {
    const unreadIds = notifications.filter((notification) => !notification.read).map((notification) => notification.notification_id);
    if (unreadIds.length === 0) return;
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    await markNotificationsRead(unreadIds);
  }

  function handleClassSelect(workspace) {
    selectWorkspace(workspace);
    navigate("/student");
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
          {role === "student" && (
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <Badge tone="role">{studentClasses.length} enrolled</Badge>
              <div className="flex min-w-0 items-center gap-2">
                {studentClasses.length === 0 ? (
                  <span className="text-sm font-bold text-slate-500 dark:text-slate-400">No classes assigned yet</span>
                ) : (
                  studentClasses.slice(0, 3).map((workspace) => (
                    <button
                      key={`${workspace.type}-${workspace.class_id}`}
                      className={cn(
                        "focus-ring inline-flex max-w-48 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition",
                        roleWorkspace?.class_id === workspace.class_id
                          ? "border-role-primary bg-role-soft text-role-primary"
                          : "border-role-border bg-white text-slate-600 hover:border-role-primary hover:text-role-primary dark:bg-slate-900 dark:text-slate-200",
                      )}
                      type="button"
                      onClick={() => handleClassSelect(workspace)}
                    >
                      <BookOpen size={14} />
                      <span className="truncate">{workspace.class_name ?? workspace.label ?? "Class"}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
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
          <div ref={notificationsRef} className="relative">
            <Button variant="ghost" size="sm" type="button" aria-label="Notifications" onClick={handleNotificationsToggle}>
              <span className="relative">
                <Bell size={17} />
                {unreadCount > 0 && (
                  <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
            </Button>

            {notificationsOpen && (
              <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[24px] border border-role-border bg-white shadow-lift dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3 border-b border-role-border px-4 py-3 dark:border-slate-800">
                  <div>
                    <p className="text-sm font-black text-slate-950 dark:text-white">Notifications</p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{unreadCount} unread</p>
                  </div>
                  <button
                    className="focus-ring rounded-full p-2 text-slate-500 hover:bg-role-hover hover:text-role-primary dark:text-slate-300"
                    type="button"
                    aria-label="Mark all notifications read"
                    onClick={handleMarkAllRead}
                  >
                    <CheckCheck size={16} />
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto p-2">
                  {notifications.length === 0 && (
                    <div className="grid place-items-center rounded-[20px] bg-role-hover px-4 py-8 text-center dark:bg-slate-950/40">
                      <Bell className="text-role-primary" size={24} />
                      <p className="mt-3 text-sm font-black text-slate-800 dark:text-white">No notifications yet</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Class updates will appear here.</p>
                    </div>
                  )}
                  {notifications.map((notification) => (
                    <div key={notification.notification_id} className="flex gap-3 rounded-[20px] px-3 py-3 hover:bg-role-hover dark:hover:bg-slate-950/40">
                      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", notification.read ? "bg-slate-300" : notificationTone[notification.tone] ?? notificationTone.info)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-black text-slate-900 dark:text-white">{notification.title}</p>
                          <span className="shrink-0 text-[11px] font-bold text-slate-400">{formatNotificationTime(notification.created_at)}</span>
                        </div>
                        {notification.description && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{notification.description}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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

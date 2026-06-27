import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { cn } from "../utils/cn";
import { Button } from "./Button";

const ToastContext = createContext(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: TriangleAlert,
  info: Info,
};

const MAX_VISIBLE_TOASTS = 3;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ title, description, tone = "info", duration = 4200, dedupeKey }) => {
      const id = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      setToasts((current) => {
        const resolvedDedupeKey = dedupeKey || `${tone}:${title || ""}:${description || ""}`;
        const existing = current.find((toast) => toast.dedupeKey === resolvedDedupeKey);
        if (existing) return current;
        return [...current, { id, title, description, tone, dedupeKey: resolvedDedupeKey }].slice(-MAX_VISIBLE_TOASTS);
      });
      if (duration > 0) window.setTimeout(() => dismissToast(id), duration);
      return id;
    },
    [dismissToast],
  );

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[70] flex flex-col-reverse items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end">
        {toasts.map((toast) => {
          const Icon = icons[toast.tone] ?? Info;
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-4 text-[var(--color-text)] shadow-lift",
                toast.tone === "success" && "border-[color:var(--color-success)]",
                toast.tone === "error" && "border-red-300",
                toast.tone === "warning" && "border-amber-300",
                toast.tone === "info" && "border-[color:var(--color-border)]",
              )}
            >
              <Icon className={toast.tone === "error" ? "text-red-600" : "text-[var(--color-primary)]"} size={18} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black">{toast.title}</p>
                {toast.description && <p className="mt-1 text-sm leading-5 text-[var(--color-muted)]">{toast.description}</p>}
              </div>
              <Button className="h-8 px-2" type="button" variant="ghost" size="sm" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
                <X size={15} />
              </Button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "./Button";

export function Modal({ open, title, children, footer, onClose, panelClassName = "", bodyClassName = "", closeDisabled = false }) {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-slate-950/40 p-4 backdrop-blur-sm sm:p-8">
      <section
        className={`flex max-h-[calc(100vh-32px)] w-[92vw] max-w-lg flex-col overflow-hidden rounded-[var(--role-radius)] border border-[var(--role-card-border)] bg-white shadow-lift dark:bg-slate-900 sm:max-h-[calc(100vh-64px)] ${panelClassName}`}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-role-border bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">{title}</h2>
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={closeDisabled} aria-label="Close modal">
            <X size={17} />
          </Button>
        </div>
        <div className={`subtle-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 ${footer ? "pb-8" : ""} ${bodyClassName}`}>{children}</div>
        {footer && (
          <div className="sticky bottom-0 z-10 shrink-0 border-t border-role-border bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
            {footer}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

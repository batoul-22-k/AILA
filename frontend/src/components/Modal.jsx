import { X } from "lucide-react";

import { Button } from "./Button";

export function Modal({ open, title, children, onClose, panelClassName = "", closeDisabled = false }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-slate-950/40 p-3 backdrop-blur-sm sm:place-items-center">
      <section className={`w-full max-w-lg rounded-[var(--role-radius)] border border-[var(--role-card-border)] bg-white p-5 shadow-lift dark:bg-slate-900 ${panelClassName}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">{title}</h2>
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={closeDisabled} aria-label="Close modal">
            <X size={17} />
          </Button>
        </div>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
